import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import {
  SmartLight,
  SmartLightEffectConfig,
  SmartLightState,
  SmartLightStateInput,
  SmartLightZoneLayout,
  SmartLightZonePalette,
  UniverseState
} from "@lightbridgedmx/shared";
import { DmxService } from "../dmx";
import { Store } from "../../state/store";
import { defaultLinearLayout, evaluateEffect } from "./effect-engine";
import { NanoleafApiError, NanoleafClient, rgbToHsv } from "./nanoleaf-client";
import { NanoleafStreamer } from "./nanoleaf-streamer";

type RuntimeEntry = {
  light: SmartLight;
  client: NanoleafClient | null;
  streamer: NanoleafStreamer | null;
  /** Last state we successfully pushed via HTTP. */
  lastPushed: SmartLightState | null;
  /** Desired state — diffed against lastPushed by the flush loop. */
  desired: SmartLightState;
  /** Optional per-zone palette — when set, streamer pushes this instead of uniform color.
   *  Cleared when a uniform-color write arrives via setState/applyState. */
  zonePalette: SmartLightZonePalette | null;
  /** Timestamp of last successful network call (HTTP push). */
  lastPushAt: number;
  /** Concurrent HTTP push guard. */
  inflight: boolean;
  /** Timestamp of last local write — refresh from device only fires if quiescent. */
  lastLocalWriteAt: number;
  /** When true, Dance mode owns this device — streamAll() bypasses currentEffect and
   *  desired.on so the dance can paint zones over whatever ambient state is configured.
   *  Set via setDanceClaim(); does NOT persist to DB. */
  danceClaim: boolean;
};

const MIN_PUSH_INTERVAL_MS = 70;     // HTTP rate limit per device — ~14 writes/s
const FLUSH_INTERVAL_MS = 30;        // ~33 Hz coalesce tick (HTTP path)
const STREAM_INTERVAL_MS = 33;       // ~30 Hz streaming frame cadence (UDP path)
const REFRESH_INTERVAL_MS = 5000;    // periodic refresh from device
const REFRESH_QUIESCENT_MS = 2000;   // don't refresh if user wrote within this window

/**
 * Manages a registry of "smart lights" (Nanoleaf today, more backends later) with two
 * output paths:
 *   • HTTP coalesced PUT /state (default, ~100 ms latency, no extra device state)
 *   • UDP extControl v2 streaming (~5–15 ms latency, requires streamer.enable())
 *
 * Plus:
 *   • Bidirectional DMX mirror (mirror RGB/brightness from configured DMX channels)
 *   • Periodic state refresh from device (so external apps editing the strip stay in sync)
 *   • Effects pass-through (selectEffect via NanoleafClient)
 *
 * Emits "light_updated" whenever a smart light's state changes (after a successful push
 * or after a sync from device). Listeners (websocket layer) re-broadcast.
 */
export class SmartLightService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly runtime = new Map<string, RuntimeEntry>();
  private flushTimer: NodeJS.Timeout | null = null;
  private streamTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly store: Store;
  private readonly dmx: DmxService;
  private readonly tickHandler: (state: UniverseState) => void;

  constructor(logger: FastifyBaseLogger, dmx: DmxService, store: Store) {
    super();
    this.logger = logger.child({ service: "smart-lights" });
    this.dmx = dmx;
    this.store = store;
    this.tickHandler = (state) => this.onDmxTick(state);
  }

  async start(): Promise<void> {
    const lights = await this.store.listSmartLights();
    for (const light of lights) await this.registerInternal(light);

    this.dmx.on("tick", this.tickHandler);
    this.flushTimer = setInterval(() => this.flushAll(), FLUSH_INTERVAL_MS);
    this.streamTimer = setInterval(() => this.streamAll(), STREAM_INTERVAL_MS);
    this.refreshTimer = setInterval(() => this.refreshAllIfQuiescent(), REFRESH_INTERVAL_MS);
    this.logger.info({ count: lights.length }, "SmartLightService started");

    // Best-effort initial sync from each device so the UI shows a real state.
    for (const entry of this.runtime.values()) {
      void this.refreshFromDevice(entry);
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.streamTimer) clearInterval(this.streamTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.flushTimer = this.streamTimer = this.refreshTimer = null;
    this.dmx.off("tick", this.tickHandler);
    for (const entry of this.runtime.values()) {
      if (entry.streamer) await entry.streamer.disable().catch(() => {});
    }
    this.runtime.clear();
  }

  async register(light: SmartLight): Promise<void> {
    await this.registerInternal(light);
    const entry = this.runtime.get(light.id);
    if (entry) void this.refreshFromDevice(entry);
  }

  async unregister(id: string): Promise<void> {
    const entry = this.runtime.get(id);
    if (entry?.streamer) await entry.streamer.disable().catch(() => {});
    this.runtime.delete(id);
  }

  listWithState(): SmartLight[] {
    return [...this.runtime.values()].map((entry) => ({
      ...entry.light,
      state: entry.desired
    }));
  }

  getWithState(id: string): SmartLight | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    return { ...entry.light, state: entry.desired };
  }

  applyState(id: string, patch: SmartLightStateInput): SmartLight | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    entry.lastLocalWriteAt = Date.now();

    const next: SmartLightState = { ...entry.desired };
    if (patch.rgb) {
      const { h, s, v } = rgbToHsv(patch.rgb.r, patch.rgb.g, patch.rgb.b);
      next.hue = h;
      next.sat = s;
      next.colorMode = "hs";
      if (patch.brightness === undefined) next.brightness = v;
      if (patch.on === undefined && (patch.rgb.r > 0 || patch.rgb.g > 0 || patch.rgb.b > 0)) {
        next.on = true;
      }
    }
    if (patch.on !== undefined) next.on = patch.on;
    if (patch.hue !== undefined) {
      next.hue = patch.hue;
      next.colorMode = "hs";
    }
    if (patch.sat !== undefined) {
      next.sat = patch.sat;
      next.colorMode = "hs";
    }
    if (patch.brightness !== undefined) next.brightness = patch.brightness;
    if (patch.ct !== undefined) {
      next.ct = patch.ct;
      next.colorMode = "ct";
    }

    entry.desired = next;
    entry.zonePalette = null; // uniform-color write clears any per-zone palette
    return { ...entry.light, state: next };
  }

  /** Push a per-zone palette via the streamer. Requires streaming.enabled = true. */
  applyZones(id: string, palette: SmartLightZonePalette): SmartLight | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    entry.lastLocalWriteAt = Date.now();
    if (!entry.streamer?.isEnabled()) {
      throw new Error("Streaming not enabled on this smart light");
    }
    entry.zonePalette = palette;
    entry.streamer.sendZones(palette.zones);
    return { ...entry.light, state: entry.desired };
  }

  /** Select a builtin effect. Effect mode persists until next setState. */
  async selectEffect(id: string, effectName: string): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry?.client) return undefined;
    entry.lastLocalWriteAt = Date.now();
    if (entry.streamer?.isEnabled()) await entry.streamer.disable();
    await entry.client.selectEffect(effectName);
    entry.desired = { ...entry.desired, colorMode: "effect", currentEffect: effectName };
    this.emit("light_updated", { ...entry.light, state: entry.desired });
    return { ...entry.light, state: entry.desired };
  }

  async listEffects(id: string): Promise<string[]> {
    const entry = this.runtime.get(id);
    if (!entry?.client) throw new Error("Unknown smart light or no client");
    return entry.client.listEffects();
  }

  /** Set or clear the active effect. Persists to DB; engine picks it up on next stream tick. */
  async setEffect(id: string, effect: SmartLightEffectConfig | null): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    entry.lastLocalWriteAt = Date.now();
    const updated = await this.store.updateSmartLight(id, { currentEffect: effect });
    entry.light = updated;
    this.emit("light_updated", { ...updated, state: entry.desired });
    return { ...updated, state: entry.desired };
  }

  /** Update the per-zone physical layout (start/end coords of every zone). */
  async setLayout(id: string, layout: SmartLightZoneLayout | null): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    const updated = await this.store.updateSmartLight(id, { zoneLayout: layout });
    entry.light = updated;
    this.emit("light_updated", { ...updated, state: entry.desired });
    return { ...updated, state: entry.desired };
  }

  /** Enable/disable streaming for a light. Persists user choice + restarts UDP socket. */
  async setStreaming(id: string, enabled: boolean, zoneCount?: number): Promise<SmartLight | undefined> {
    const entry = this.runtime.get(id);
    if (!entry?.client) return undefined;

    if (enabled) {
      const zc = zoneCount ?? entry.light.streaming?.zoneCount ?? 50;
      if (!entry.streamer) {
        entry.streamer = new NanoleafStreamer({
          host: entry.light.config.host,
          port: 60222,
          zoneCount: zc,
          client: entry.client,
          logger: this.logger
        });
      } else {
        entry.streamer.setZoneCount(zc);
      }
      await entry.streamer.enable();
    } else {
      if (entry.streamer) await entry.streamer.disable();
    }

    const updated = await this.store.updateSmartLight(id, {
      streaming: { enabled, zoneCount: zoneCount ?? entry.light.streaming?.zoneCount }
    });
    entry.light = updated;
    this.emit("light_updated", { ...updated, state: entry.desired });
    return { ...updated, state: entry.desired };
  }

  /**
   * Register or update a light in the runtime. CRITICAL: re-uses the existing client
   * and streamer when possible — recreating either on every config update was causing
   * multiple UDP sockets to fight over the device (visible flicker) because the old
   * streamer's keepalive kept running after a new one was installed.
   *
   * Streamer is only torn down + recreated when:
   *   • The light's host or port changed (different physical device)
   *   • The user explicitly toggled streaming off (handled by setStreaming, not here)
   * Otherwise, the existing streamer is kept and its zoneCount is updated in place.
   */
  private async registerInternal(light: SmartLight): Promise<void> {
    const existing = this.runtime.get(light.id);
    const isNanoleaf = light.backend === "nanoleaf-http" && light.config.type === "nanoleaf-http";

    // ── Client ─────────────────────────────────────────────────────────────
    // Re-use existing client unless the host or token changed.
    let client: NanoleafClient | null = existing?.client ?? null;
    if (isNanoleaf) {
      const prevConfig = existing?.light.config.type === "nanoleaf-http" ? existing.light.config : null;
      const configChanged =
        !prevConfig ||
        prevConfig.host !== light.config.host ||
        prevConfig.port !== light.config.port ||
        prevConfig.token !== light.config.token;
      if (configChanged || !client) {
        client = new NanoleafClient({
          host: light.config.host,
          port: light.config.port,
          token: light.config.token,
          logger: this.logger
        });
      }
    } else {
      client = null;
    }

    // ── Streamer ────────────────────────────────────────────────────────────
    // Re-use existing streamer if the host hasn't changed. Update its zone count
    // in place. Only call enable() if the streamer isn't already enabled.
    let streamer: NanoleafStreamer | null = existing?.streamer ?? null;
    const wantStreaming = isNanoleaf && light.streaming?.enabled === true && !!light.config.token;
    const zc = (isNanoleaf && light.streaming?.zoneCount) || 50;

    if (wantStreaming && client) {
      const prevHost = existing?.light.config.type === "nanoleaf-http" ? existing.light.config.host : null;
      const hostChanged = prevHost && prevHost !== light.config.host;
      if (hostChanged && streamer) {
        await streamer.disable().catch(() => {});
        streamer = null;
      }
      if (!streamer) {
        streamer = new NanoleafStreamer({
          host: light.config.host,
          port: 60222,
          zoneCount: zc,
          client,
          logger: this.logger
        });
        try {
          await streamer.enable();
        } catch (err) {
          this.logger.warn({ err, id: light.id }, "Failed to enable streaming on register — will retry on next setStreaming");
        }
      } else {
        streamer.setZoneCount(zc);
        // Don't re-call enable() if already enabled — guard exists in streamer but
        // skipping it avoids any chance of duplicate setInterval-side keepalives.
        if (!streamer.isEnabled()) {
          try {
            await streamer.enable();
          } catch (err) {
            this.logger.warn({ err, id: light.id }, "Failed to re-enable streaming on register");
          }
        }
      }
    } else if (streamer) {
      // Streaming disabled (or backend changed) — tear down any leftover streamer.
      await streamer.disable().catch(() => {});
      streamer = null;
    }

    this.runtime.set(light.id, {
      light,
      client,
      streamer,
      lastPushed: existing?.lastPushed ?? null,
      desired:
        existing?.desired ??
        { on: false, hue: 0, sat: 0, brightness: 0, reachable: true },
      zonePalette: existing?.zonePalette ?? null,
      lastPushAt: existing?.lastPushAt ?? 0,
      inflight: false,
      lastLocalWriteAt: existing?.lastLocalWriteAt ?? 0,
      danceClaim: existing?.danceClaim ?? false
    });
  }

  /**
   * Mark a smart light as owned by Dance mode (or release it). When claimed:
   *   • streamAll() ignores `currentEffect` and `desired.on` for this device
   *   • The next call to applyZones() drives the strip
   * When released, the effect & ambient state resume on the next stream tick. The
   * persisted state (effect, layout, streaming flag) is untouched.
   *
   * Returns true if the claim was applied. Returns false if the light isn't
   * registered or streaming isn't enabled (Dance can't drive an HTTP-only device).
   */
  setDanceClaim(id: string, claimed: boolean): boolean {
    const entry = this.runtime.get(id);
    if (!entry) return false;
    if (claimed && !entry.streamer?.isEnabled()) return false;
    entry.danceClaim = claimed;
    if (!claimed) {
      // Drop the dance-painted palette so the next stream tick falls back to
      // currentEffect / ambient color.
      entry.zonePalette = null;
    }
    return true;
  }

  private async refreshFromDevice(entry: RuntimeEntry): Promise<void> {
    if (!entry.client || !entry.light.config.token) return;
    try {
      const info = await entry.client.getInfo();
      entry.desired = { ...info.state, reachable: true };
      entry.lastPushed = entry.desired;
      this.emit("light_updated", { ...entry.light, state: entry.desired });
    } catch (err) {
      if (err instanceof NanoleafApiError && err.status === 401) {
        this.logger.warn({ id: entry.light.id }, "Nanoleaf token invalid — re-pair the device");
      } else {
        this.logger.warn({ err, id: entry.light.id }, "Failed to refresh smart light from device");
      }
      entry.desired = { ...entry.desired, reachable: false };
      this.emit("light_updated", { ...entry.light, state: entry.desired });
    }
  }

  /** Refresh lights that haven't received a local write in REFRESH_QUIESCENT_MS.
   *  This catches external mutations (Apple Home, Nanoleaf app) without fighting the user. */
  private refreshAllIfQuiescent(): void {
    const now = Date.now();
    for (const entry of this.runtime.values()) {
      // Streaming mode owns the strip entirely — no point refreshing.
      if (entry.streamer?.isEnabled()) continue;
      if (now - entry.lastLocalWriteAt < REFRESH_QUIESCENT_MS) continue;
      // Only refresh if our diff is settled (we're not mid-push of a queued change).
      const diff = computeStateDiff(entry.lastPushed, entry.desired);
      if (diff) continue;
      void this.refreshFromDevice(entry);
    }
  }

  /** DMX tick → update desired state of any DMX-mirrored light. */
  private onDmxTick(state: UniverseState): void {
    for (const entry of this.runtime.values()) {
      const mirror = entry.light.dmxMirror;
      if (!mirror) continue;
      const read = (channel?: number) =>
        channel && channel >= 1 && channel <= 512 ? state.values[channel - 1] : undefined;

      const r = read(mirror.rChannel);
      const g = read(mirror.gChannel);
      const b = read(mirror.bChannel);
      const bri = read(mirror.briChannel);

      if (r === undefined && g === undefined && b === undefined && bri === undefined) continue;

      const next: SmartLightState = { ...entry.desired };

      if (r !== undefined || g !== undefined || b !== undefined) {
        const { h, s, v } = rgbToHsv(r ?? 0, g ?? 0, b ?? 0);
        next.hue = h;
        next.sat = s;
        next.colorMode = "hs";
        if (bri === undefined) {
          next.brightness = v;
          next.on = v > 0;
        }
      }
      if (bri !== undefined) {
        next.brightness = (bri / 255) * 100;
        next.on = bri > 0;
      }

      entry.desired = next;
      entry.zonePalette = null; // DMX mirror is a uniform write
      entry.lastLocalWriteAt = Date.now();
    }
  }

  /** HTTP path: walk every NON-streaming light and push diffs. */
  private flushAll(): void {
    const now = Date.now();
    for (const entry of this.runtime.values()) {
      if (!entry.client || !entry.light.config.token) continue;
      if (entry.streamer?.isEnabled()) continue; // streaming owns the device
      if (entry.inflight) continue;
      if (now - entry.lastPushAt < MIN_PUSH_INTERVAL_MS) continue;

      const diff = computeStateDiff(entry.lastPushed, entry.desired);
      if (!diff) continue;

      entry.inflight = true;
      const client = entry.client;
      const target = entry.desired;
      void (async () => {
        try {
          await client.setState(diff);
          entry.lastPushed = { ...target };
          entry.lastPushAt = Date.now();
          if (!entry.desired.reachable) entry.desired = { ...entry.desired, reachable: true };
          this.emit("light_updated", { ...entry.light, state: entry.desired });
        } catch (err) {
          this.logger.warn({ err, id: entry.light.id }, "Failed to push smart light state");
          entry.desired = { ...entry.desired, reachable: false };
          this.emit("light_updated", { ...entry.light, state: entry.desired });
          entry.lastPushAt = Date.now() + 500;
        } finally {
          entry.inflight = false;
        }
      })();
    }
  }

  /** UDP path: for each streaming light, push the current desired state every ~33 ms.
   *  We send EVERY tick (not just on diff) because:
   *    1. UDP is cheap (no TCP handshake)
   *    2. Continuous frames keep the device in extControl mode (it exits otherwise)
   *    3. Late-arriving DMX changes get applied in the next tick automatically
   *
   *  Priority order, highest first:
   *    1. currentEffect set  → EffectEngine computes per-zone frame
   *    2. zonePalette set    → static per-zone palette (from /zones API)
   *    3. otherwise          → uniform color from desired HSB
   */
  private streamAll(): void {
    const tNow = Date.now() / 1000;
    for (const entry of this.runtime.values()) {
      const s = entry.streamer;
      if (!s?.isEnabled()) continue;
      // Dance mode owns the device: bypass currentEffect priority and the
      // desired.on guard. Whatever palette DanceService just pushed (or none) wins.
      if (entry.danceClaim) {
        if (entry.zonePalette) {
          s.sendZones(entry.zonePalette.zones);
        } else {
          s.sendUniform({ r: 0, g: 0, b: 0 });
        }
        continue;
      }
      if (!entry.desired.on) {
        s.sendUniform({ r: 0, g: 0, b: 0 });
        continue;
      }
      const effect = entry.light.currentEffect;
      if (effect) {
        const layout = entry.light.zoneLayout ?? defaultLinearLayout(entry.light.streaming?.zoneCount ?? 50);
        const frame = evaluateEffect(effect, layout, tNow);
        s.sendZones(frame.map((c, i) => ({ index: i, r: c.r, g: c.g, b: c.b })));
        continue;
      }
      if (entry.zonePalette) {
        s.sendZones(entry.zonePalette.zones);
        continue;
      }
      const rgb = hsbToRgb(entry.desired);
      s.sendUniform(rgb);
    }
  }
}

/** Return only the fields that changed (within a small tolerance), or null if nothing to push. */
function computeStateDiff(
  prev: SmartLightState | null,
  next: SmartLightState
): { on?: boolean; hue?: number; sat?: number; brightness?: number; ct?: number } | null {
  const out: { on?: boolean; hue?: number; sat?: number; brightness?: number; ct?: number } = {};
  let any = false;
  if (!prev || prev.on !== next.on) {
    out.on = next.on;
    any = true;
  }
  if (next.on) {
    if (next.colorMode === "ct" && next.ct !== undefined) {
      if (!prev || prev.ct !== next.ct) {
        out.ct = next.ct;
        any = true;
      }
    } else {
      if (!prev || Math.abs(prev.hue - next.hue) > 1) {
        out.hue = next.hue;
        any = true;
      }
      if (!prev || Math.abs(prev.sat - next.sat) > 1) {
        out.sat = next.sat;
        any = true;
      }
    }
    if (!prev || Math.abs(prev.brightness - next.brightness) > 1) {
      out.brightness = next.brightness;
      any = true;
    }
  }
  return any ? out : null;
}

/** HSV (h:0-360, s/v:0-100) → RGB 0-255. Brightness acts as master multiplier on V. */
function hsbToRgb(state: SmartLightState): { r: number; g: number; b: number } {
  const h = state.hue;
  const sn = state.sat / 100;
  // Apply brightness as a luminance scale on V=1 (so streamed values track the slider).
  const vn = state.brightness / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}
