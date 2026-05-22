import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import {
  Capability,
  DanceConfig,
  DancePatternId,
  DanceState,
  Fixture
} from "@lightbridgedmx/shared";
import { DmxService } from "./dmx";
import { Store } from "../state/store";
import { SmartLightService } from "./smart-lights";

const PAN_TILT_CAPS: ReadonlySet<Capability> = new Set<Capability>(["pan", "tilt"]);

/** A "group" in the chase pattern: either a set of DMX channels (PAR / lyre dimmer),
 *  or a contiguous range of zones on a smart light strip (one side of the layout). */
type DanceGroup =
  | {
      kind: "dmx";
      name: string;
      // Unique id used to order groups + cluster channels by fixture.
      fixtureId: string;
      channels: { channel: number; value: number }[];
    }
  | {
      kind: "smart-light-side";
      name: string;
      // `"<smartLightId>:<sideLabel>"` — used as a stable id, never collides with fixtureId.
      fixtureId: string;
      smartLightId: string;
      zoneStart: number;
      zoneEnd: number;
    };

export class DanceService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly store: Store;
  private readonly smartLights: SmartLightService;
  private config: DanceConfig | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private currentPattern: boolean[][] | null = null;
  private currentPatternName: DancePatternId | null = null;
  private stepIdx = 0;
  private lastMask: boolean[] | null = null;
  private groups: DanceGroup[] = [];
  // Smart lights currently claimed by Dance — released on stop().
  private claimedSmartLightIds: Set<string> = new Set();
  private rememberedSnapshot = new Map<number, { value: number; fixtureId: string }>();
  private fixturesCache: Fixture[] = [];
  private shutterChannels: number[] = []; // absolute channels with capability "strobe" on lyre fixtures
  private lyreFixtures: {
    fixtureId: string;
    name: string;
    shutterChannel: number;
    dimmerChannel: number;
    panChannel: number | null;
    tiltChannel: number | null;
    speedChannel: number | null;
  }[] = [];
  private lastLyrePan: number | null = null;
  private lastLyreTilt: number | null = null;
  // Timestamp (ms epoch) when the lyre is expected to finish its current physical
  // move. While Date.now() < this value, the lyre is in transit and its dimmer +
  // shutter are forced to 0 (blackout) to avoid the "flying spotlight" effect.
  private lyreMoveEndAt = 0;
  private lastRefreshAt = 0;
  private phasesSent = 0;

  constructor(
    logger: FastifyBaseLogger,
    dmx: DmxService,
    store: Store,
    smartLights: SmartLightService
  ) {
    super();
    this.logger = logger.child({ service: "dance" });
    this.dmx = dmx;
    this.store = store;
    this.smartLights = smartLights;
  }

  async init(): Promise<void> {
    this.config = await this.store.getDanceConfig();
    await this.autoseedLyrePositions();
    await this.autoseedSmartLights();
    if (this.config.enabled) {
      this.logger.info("Resuming Dance mode from persisted config");
      await this.start();
    }
  }

  /**
   * First-run convenience: if no smart light has been configured for Dance yet, enable
   * Dance for any smart lights that already have labelled sides in their zoneLayout.
   * Side labels mean the user has explicitly carved the strip into spatial sections —
   * a clear signal they want it to participate in chases.
   */
  private async autoseedSmartLights() {
    if (!this.config) return;
    if (this.config.smartLights.lightIds.length > 0) return;
    const lights = this.smartLights.listWithState();
    const candidates = lights
      .filter((l) => (l.zoneLayout?.sides?.length ?? 0) > 0)
      .map((l) => l.id);
    if (candidates.length === 0) return;
    this.config = await this.store.saveDanceConfig({
      ...this.config,
      smartLights: { enabled: true, lightIds: candidates },
      updatedAt: new Date().toISOString()
    });
    this.logger.info({ lightIds: candidates }, "Auto-seeded smart lights for Dance mode");
  }

  /**
   * Auto-seed known lyre pan/tilt positions for the salon PARs the first time we
   * see them. Values come from the user's measurements:
   *   Par 56 - Café  → pan=51, tilt=9   (spot on right of front wall)
   *   Par 56 - Lava  → pan=41, tilt=7   (spot on left of front wall, beams cross)
   */
  private async autoseedLyrePositions() {
    if (!this.config) return;
    const fixtures = await this.store.listFixtures();
    const seeds: Record<string, { pan: number; tilt: number }> = {
      "Par 56 - Café": { pan: 51, tilt: 9 },
      "Par 56 - Lava": { pan: 41, tilt: 7 }
    };
    const existing = new Set(this.config.lyre.positions.map((p) => p.fixtureId));
    const additions = [];
    for (const f of fixtures) {
      const seed = seeds[f.name];
      if (seed && !existing.has(f.id)) {
        additions.push({ fixtureId: f.id, pan: seed.pan, tilt: seed.tilt });
      }
    }
    if (additions.length > 0) {
      this.config = await this.store.saveDanceConfig({
        ...this.config,
        lyre: {
          ...this.config.lyre,
          positions: [...this.config.lyre.positions, ...additions]
        },
        updatedAt: new Date().toISOString()
      });
      this.logger.info({ additions }, "Auto-seeded lyre positions");
    }
  }

  async getState(): Promise<DanceState> {
    if (!this.config) this.config = await this.store.getDanceConfig();
    return {
      config: this.config,
      running: this.running,
      activeFixtureIds: this.groups.map((g) => g.fixtureId),
      currentPattern: this.currentPatternName,
      phasesSent: this.phasesSent
    };
  }

  async updateConfig(patch: Partial<DanceConfig>): Promise<DanceState> {
    const current = this.config ?? (await this.store.getDanceConfig());
    const prevLyreEnabled = current.lyre.enabled;
    const next: DanceConfig = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const prevSmartLightIds = new Set(current.smartLights.lightIds);
    const prevSmartLightsEnabled = current.smartLights.enabled;
    this.config = await this.store.saveDanceConfig(next);
    if (this.running) {
      // Reconcile smart light claims: release lights that were removed (or disabled),
      // claim new ones. Skip if smartLights is disabled entirely.
      const nextEnabled = this.config.smartLights.enabled;
      const nextIds = new Set(this.config.smartLights.lightIds);
      if (prevSmartLightsEnabled && !nextEnabled) {
        this.releaseAllSmartLights();
      } else {
        for (const id of this.claimedSmartLightIds) {
          if (!nextIds.has(id)) {
            this.smartLights.setDanceClaim(id, false);
            this.claimedSmartLightIds.delete(id);
          }
        }
        if (nextEnabled) {
          for (const id of nextIds) {
            if (this.claimedSmartLightIds.has(id)) continue;
            if (this.smartLights.setDanceClaim(id, true)) {
              this.claimedSmartLightIds.add(id);
            }
          }
        }
      }
      void prevSmartLightIds; // silence unused — kept for future diff logging if needed
      // Refresh active groups to apply room/exclusion/lyre/smart-light changes immediately.
      await this.refreshGroups({ force: true });
      this.currentPattern = null;
      this.lastMask = null;
      // If the user just disabled lyre mode mid-run, close shutter + dimmer.
      if (prevLyreEnabled && !this.config.lyre.enabled) {
        this.closeShutters();
        for (const lyre of this.lyreFixtures) {
          this.dmx.setChannel(lyre.dimmerChannel, 0);
        }
      }
    }
    this.emitState();
    return this.getState();
  }

  async start(): Promise<DanceState> {
    if (this.running) return this.getState();
    if (!this.config) this.config = await this.store.getDanceConfig();
    if (!this.config.enabled) {
      this.config = await this.store.saveDanceConfig({ ...this.config, enabled: true, updatedAt: new Date().toISOString() });
    }
    this.running = true;
    this.phasesSent = 0;
    this.rememberedSnapshot.clear();
    this.claimConfiguredSmartLights();
    await this.refreshGroups({ force: true });
    this.scheduleNext(0);
    this.logger.info({ groups: this.groups.length, smartLights: this.claimedSmartLightIds.size }, "Dance started");
    this.emitState();
    return this.getState();
  }

  async stop(): Promise<DanceState> {
    if (!this.running && !this.timer) {
      return this.getState();
    }
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.currentPattern = null;
    this.currentPatternName = null;
    this.lastMask = null;
    // Close shutters so the lyre dims out cleanly; PAR channels keep their last
    // phase value (consistent with the original "leave as-is" behavior).
    this.closeShutters();
    // Also drop dimmer of each lyre to 0 so it doesn't stay lit at last mask.
    for (const lyre of this.lyreFixtures) {
      this.dmx.setChannel(lyre.dimmerChannel, 0);
    }
    // Release all smart lights — they revert to their persisted ambient effect.
    this.releaseAllSmartLights();
    // Reset cached lyre target so the next start re-evaluates from scratch.
    this.lastLyrePan = null;
    this.lastLyreTilt = null;
    this.lyreMoveEndAt = 0;
    if (this.config?.enabled) {
      this.config = await this.store.saveDanceConfig({
        ...this.config,
        enabled: false,
        updatedAt: new Date().toISOString()
      });
    }
    this.logger.info("Dance stopped");
    this.emitState();
    return this.getState();
  }

  /** Claim every smart light listed in `config.smartLights.lightIds`. Only lights with
   *  streaming actually enabled are claimable — others are skipped with a warning. */
  private claimConfiguredSmartLights() {
    this.claimedSmartLightIds.clear();
    if (!this.config?.smartLights.enabled) return;
    for (const id of this.config.smartLights.lightIds) {
      const ok = this.smartLights.setDanceClaim(id, true);
      if (ok) {
        this.claimedSmartLightIds.add(id);
      } else {
        this.logger.warn({ id }, "Could not claim smart light for Dance — streaming disabled or unknown light");
      }
    }
  }

  private releaseAllSmartLights() {
    for (const id of this.claimedSmartLightIds) {
      this.smartLights.setDanceClaim(id, false);
    }
    this.claimedSmartLightIds.clear();
  }

  // ----- internals -----

  private emitState() {
    void this.getState()
      .then((s) => this.emit("state", s))
      .catch((err) => this.logger.error({ err }, "Failed to emit dance state"));
  }

  private async refreshGroups(opts: { force?: boolean } = {}): Promise<void> {
    if (!this.config) return;
    const now = Date.now();
    if (!opts.force && now - this.lastRefreshAt < 2500) return;
    this.lastRefreshAt = now;
    this.fixturesCache = await this.store.listFixtures();

    const allowedRooms = new Set(this.config.rooms);
    const excludedCaps = new Set<Capability>(this.config.excludeCapabilities);
    const snapshot = this.dmx.getUniverseSnapshot();

    // Map abs channel -> { fixture, capability }
    const channelMeta = new Map<number, { fixtureId: string; fixtureName: string; capability: Capability; room?: string }>();
    for (const f of this.fixturesCache) {
      if (allowedRooms.size > 0 && (!f.room || !allowedRooms.has(f.room))) continue;
      for (const ch of f.channels) {
        const abs = f.address + ch.channel - 1;
        if (this.config.excludePanTilt && PAN_TILT_CAPS.has(ch.capability)) continue;
        if (excludedCaps.has(ch.capability)) continue;
        channelMeta.set(abs, { fixtureId: f.id, fixtureName: f.name, capability: ch.capability, room: f.room });
      }
    }

    // Ingest snapshot additively: keep last seen non-zero value for each tracked channel.
    for (const [abs, meta] of channelMeta) {
      const v = snapshot[abs - 1] ?? 0;
      if (v > 0) {
        this.rememberedSnapshot.set(abs, { value: v, fixtureId: meta.fixtureId });
      }
    }

    // Drop remembered channels that are no longer tracked (e.g., rooms changed).
    for (const abs of [...this.rememberedSnapshot.keys()]) {
      if (!channelMeta.has(abs)) this.rememberedSnapshot.delete(abs);
    }

    // Build groups by fixture id, preserve fixture spatial order = creation order in DB
    // (overridable later by an explicit `position` field on Fixture if needed).
    const byFixture = new Map<string, Extract<DanceGroup, { kind: "dmx" }>>();
    for (const [abs, { value, fixtureId }] of this.rememberedSnapshot) {
      const meta = channelMeta.get(abs);
      if (!meta) continue;
      if (!byFixture.has(fixtureId)) {
        byFixture.set(fixtureId, { kind: "dmx", name: meta.fixtureName, fixtureId, channels: [] });
      }
      byFixture.get(fixtureId)!.channels.push({ channel: abs, value });
    }

    // Order groups by the order they appear in fixturesCache (DB order, "spatial-ish").
    const order = new Map<string, number>();
    this.fixturesCache.forEach((f, i) => order.set(f.id, i));
    this.groups = [...byFixture.values()].sort(
      (a, b) => (order.get(a.fixtureId) ?? 0) - (order.get(b.fixtureId) ?? 0)
    );

    // Identify lyre fixtures (those with BOTH a strobe channel and an intensity channel).
    // Lyres bypass the room filter — they join the dance whenever lyre mode is enabled.
    // Pan/tilt channels are tracked too, so the lyre can follow the chase visually.
    this.lyreFixtures = [];
    this.shutterChannels = [];
    for (const f of this.fixturesCache) {
      const strobeCh = f.channels.find((c) => c.capability === "strobe");
      const dimmerCh = f.channels.find((c) => c.capability === "intensity");
      if (strobeCh && dimmerCh) {
        const shutterAbs = f.address + strobeCh.channel - 1;
        const dimmerAbs = f.address + dimmerCh.channel - 1;
        // Take the first non-fine pan/tilt channel for coarse positioning.
        const panCh = f.channels.find((c) => c.capability === "pan" && !/fine/i.test(c.name ?? ""))
          ?? f.channels.find((c) => c.capability === "pan");
        const tiltCh = f.channels.find((c) => c.capability === "tilt" && !/fine/i.test(c.name ?? ""))
          ?? f.channels.find((c) => c.capability === "tilt");
        // Speed channel = "Response speed" on Stairville moving heads (capability "speed").
        const speedCh = f.channels.find((c) => c.capability === "speed");
        this.lyreFixtures.push({
          fixtureId: f.id,
          name: f.name,
          shutterChannel: shutterAbs,
          dimmerChannel: dimmerAbs,
          panChannel: panCh ? f.address + panCh.channel - 1 : null,
          tiltChannel: tiltCh ? f.address + tiltCh.channel - 1 : null,
          speedChannel: speedCh ? f.address + speedCh.channel - 1 : null
        });
        this.shutterChannels.push(shutterAbs);
      }
    }

    // If lyre mode is enabled, append each lyre as a virtual group (its dimmer is what
    // the pattern toggles). Placed at the end of the spatial chain on purpose so chase
    // patterns naturally include it as the rightmost element.
    if (this.config?.lyre.enabled) {
      const dimmerOn = this.config.lyre.dimmerOnValue;
      for (const lyre of this.lyreFixtures) {
        // Avoid duplicate group if the lyre already showed up via the snapshot logic.
        if (this.groups.some((g) => g.fixtureId === lyre.fixtureId)) continue;
        this.groups.push({
          kind: "dmx",
          name: lyre.name,
          fixtureId: lyre.fixtureId,
          channels: [{ channel: lyre.dimmerChannel, value: dimmerOn }]
        });
      }
    }

    // Append one virtual group per labelled "side" of each CLAIMED smart light's layout.
    // We key off `claimedSmartLightIds` (not the config list) so side groups only appear
    // when the light is actually under Dance's control — guarantees applyZones() won't
    // throw on a streaming-disabled device, and side groups can't outlive a claim release.
    if (this.config?.smartLights.enabled && this.claimedSmartLightIds.size > 0) {
      for (const lightId of this.claimedSmartLightIds) {
        const light = this.smartLights.getWithState(lightId);
        if (!light) continue;
        const layout = light.zoneLayout;
        if (!layout || !layout.sides || layout.sides.length === 0) continue;
        for (const side of layout.sides) {
          this.groups.push({
            kind: "smart-light-side",
            name: `${light.name} · ${side.label}`,
            fixtureId: `${light.id}:${side.label}`,
            smartLightId: light.id,
            zoneStart: side.zoneStart,
            zoneEnd: side.zoneEnd
          });
        }
      }
    }
  }

  private isLyreInMotion(): boolean {
    return Date.now() < this.lyreMoveEndAt;
  }

  private applyShutterOpen() {
    if (!this.config?.lyre.enabled) return;
    // During lyre motion, force shutter CLOSED (blackout). When idle, open it.
    const value = this.isLyreInMotion() ? 0 : this.config.lyre.shutterOpenValue;
    for (const channel of this.shutterChannels) {
      this.dmx.setChannel(channel, value);
    }
  }

  /**
   * After the pattern mask is applied, override the lyre's dimmer to 0 if the lyre is
   * currently in transit. This is what makes the lyre "blackout while flying" — only
   * lighting up once it has reached its target position.
   */
  private applyLyreBlackoutDuringMove() {
    if (!this.config?.lyre.enabled) return;
    if (!this.isLyreInMotion()) return;
    for (const lyre of this.lyreFixtures) {
      this.dmx.setChannel(lyre.dimmerChannel, 0);
    }
  }

  private applyLyreSpeed() {
    if (!this.config?.lyre.enabled) return;
    const speed = this.config.lyre.speedValue;
    for (const lyre of this.lyreFixtures) {
      if (lyre.speedChannel) this.dmx.setChannel(lyre.speedChannel, speed);
    }
  }

  /**
   * Compute pan/tilt target by interpolating between known fixture positions, then
   * move the lyre to follow the active groups in the current mask.
   *
   * Known positions form anchor points (groupIndex → pan/tilt). For groups without a
   * stored position, we linearly extrapolate using the two outermost known anchors.
   * Lyre fixtures themselves are excluded from the target computation (the lyre is
   * the actor, not a target).
   */
  private applyLyrePanTilt(mask: boolean[]) {
    if (!this.config?.lyre.enabled || !this.config.lyre.followChase) return;
    if (this.lyreFixtures.length === 0) return;

    const lyreIds = new Set(this.lyreFixtures.map((l) => l.fixtureId));
    const positionMap = new Map(this.config.lyre.positions.map((p) => [p.fixtureId, p]));

    // Build anchors sorted by their position on the visual chain (idx). Fixture-bound
    // anchors land at their group index; the optional wall-edge anchor sits one slot
    // past the last group (idx = groups.length).
    const anchors: { idx: number; pan: number; tilt: number }[] = [];
    this.groups.forEach((g, i) => {
      if (lyreIds.has(g.fixtureId)) return;
      const pos = positionMap.get(g.fixtureId);
      if (pos) anchors.push({ idx: i, pan: pos.pan, tilt: pos.tilt });
    });
    if (this.config.lyre.wallEdgeRight) {
      anchors.push({
        idx: this.groups.length,
        pan: this.config.lyre.wallEdgeRight.pan,
        tilt: this.config.lyre.wallEdgeRight.tilt
      });
    }
    anchors.sort((a, b) => a.idx - b.idx);

    if (anchors.length === 0) return;

    // Piecewise linear interpolation/extrapolation across all anchors. For an index
    // inside the anchor range, uses the bracketing pair; outside the range, extends
    // using the nearest segment.
    const sample = (i: number): { pan: number; tilt: number } => {
      if (anchors.length === 1) return { pan: anchors[0].pan, tilt: anchors[0].tilt };
      let left = anchors[0];
      let right = anchors[anchors.length - 1];
      if (i <= anchors[0].idx) {
        left = anchors[0];
        right = anchors[1];
      } else if (i >= anchors[anchors.length - 1].idx) {
        left = anchors[anchors.length - 2];
        right = anchors[anchors.length - 1];
      } else {
        for (let j = 0; j < anchors.length - 1; j++) {
          if (anchors[j].idx <= i && i <= anchors[j + 1].idx) {
            left = anchors[j];
            right = anchors[j + 1];
            break;
          }
        }
      }
      const span = right.idx - left.idx || 1;
      const t = (i - left.idx) / span;
      return {
        pan: clamp8(Math.round(left.pan + t * (right.pan - left.pan))),
        tilt: clamp8(Math.round(left.tilt + t * (right.tilt - left.tilt)))
      };
    };

    // Sum positions of ON non-lyre groups.
    let sumPan = 0;
    let sumTilt = 0;
    let count = 0;
    this.groups.forEach((g, i) => {
      if (!mask[i]) return;
      if (lyreIds.has(g.fixtureId)) return;
      const { pan, tilt } = sample(i);
      sumPan += pan;
      sumTilt += tilt;
      count++;
    });

    if (count === 0) return; // no PAR group ON → keep last lyre position
    const targetPan = Math.round(sumPan / count);
    const targetTilt = Math.round(sumTilt / count);

    if (targetPan === this.lastLyrePan && targetTilt === this.lastLyreTilt) return;

    // Don't interrupt a move in progress — the lyre will finish reaching the previous
    // target before accepting a new one. This is what keeps a coherent on/off rhythm:
    // each new target gets a clean blackout-then-light cycle.
    const now = Date.now();
    if (now < this.lyreMoveEndAt) return;

    // Compute how long this move will take: max-axis distance × ms per unit.
    // (Pan and tilt move in parallel, so the move duration is bounded by the slower
    // of the two axes, approximated by the max delta.)
    const panFrom = this.lastLyrePan ?? targetPan;
    const tiltFrom = this.lastLyreTilt ?? targetTilt;
    const distance = Math.max(Math.abs(targetPan - panFrom), Math.abs(targetTilt - tiltFrom));
    const moveDurationMs = distance * this.config.lyre.msPerPanUnit;
    this.lyreMoveEndAt = now + moveDurationMs;

    this.lastLyrePan = targetPan;
    this.lastLyreTilt = targetTilt;

    for (const lyre of this.lyreFixtures) {
      if (lyre.panChannel) this.dmx.setChannel(lyre.panChannel, targetPan);
      if (lyre.tiltChannel) this.dmx.setChannel(lyre.tiltChannel, targetTilt);
    }
  }

  private closeShutters() {
    for (const channel of this.shutterChannels) {
      this.dmx.setChannel(channel, 0);
    }
  }

  private async applyMask(mask: boolean[]) {
    // Smart-light zone palettes are accumulated per device, then flushed in one
    // applyZones() call at the end — avoids partial palettes (each side group calling
    // applyZones would overwrite the previous side's contribution).
    const palettePerLight = new Map<string, { r: number; g: number; b: number }[]>();
    const ensurePalette = (lightId: string) => {
      let arr = palettePerLight.get(lightId);
      if (!arr) {
        const light = this.smartLights.getWithState(lightId);
        const zoneCount =
          (light?.streaming?.zoneCount as number | undefined) ??
          light?.zoneLayout?.segments.length ??
          50;
        arr = Array.from({ length: zoneCount }, () => ({ r: 0, g: 0, b: 0 }));
        palettePerLight.set(lightId, arr);
      }
      return arr;
    };

    this.groups.forEach((g, i) => {
      const on = mask[i];
      if (g.kind === "dmx") {
        for (const { channel, value } of g.channels) {
          this.dmx.setChannel(channel, on ? value : 0);
        }
        return;
      }
      // smart-light-side: ensure this light's palette buffer exists even when off (so
      // the strip blacks-out non-side zones correctly).
      const palette = ensurePalette(g.smartLightId);
      if (!on) return;
      const color = this.smartLightFlashColor(g.smartLightId);
      const start = Math.max(0, Math.min(g.zoneStart, g.zoneEnd));
      const end = Math.min(palette.length - 1, Math.max(g.zoneStart, g.zoneEnd));
      for (let z = start; z <= end; z++) palette[z] = color;
    });

    // Flush each touched smart light. applyZones throws if streaming isn't enabled —
    // we only reach here for lights that were successfully claimed (start() guards it).
    for (const [lightId, zones] of palettePerLight) {
      try {
        this.smartLights.applyZones(lightId, {
          zones: zones.map((c, index) => ({ index, r: c.r, g: c.g, b: c.b }))
        });
      } catch (err) {
        this.logger.warn({ err, lightId }, "Failed to push dance zone palette");
      }
    }
  }

  /**
   * Color used when a smart-light side is "ON" in the mask. Uses the strip's current
   * desired hue/sat at full brightness so the dance pulses in the strip's ambient color.
   * Falls back to white when no color is set (brightness 0 or sat 0).
   */
  private smartLightFlashColor(lightId: string): { r: number; g: number; b: number } {
    const light = this.smartLights.getWithState(lightId);
    const state = light?.state;
    if (!state || state.sat === 0 || state.brightness === 0) {
      return { r: 255, g: 255, b: 255 };
    }
    return hsvToRgb255(state.hue, state.sat, 100);
  }

  private scheduleNext(delayMs: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick() {
    if (!this.running || !this.config) return;
    try {
      // Periodic refresh: force ALL groups ON, settle, then re-read.
      if (Date.now() - this.lastRefreshAt > 2500 && this.groups.length > 0) {
        await this.applyMask(this.groups.map(() => true));
        await sleep(80);
        await this.refreshGroups({ force: true });
        this.currentPattern = null;
        this.lastMask = null;
      } else if (this.groups.length === 0) {
        await this.refreshGroups({ force: true });
      }

      if (this.groups.length === 0) {
        this.scheduleNext(300);
        return;
      }

      if (!this.currentPattern || this.stepIdx >= this.currentPattern.length) {
        const pick = pickPattern(this.config.patterns, this.groups.length, this.groups.map((g) => g.name));
        this.currentPattern = pick.steps;
        this.currentPatternName = pick.name;
        this.stepIdx = 0;
      }

      const mask = this.currentPattern[this.stepIdx++];
      if (!masksEqual(mask, this.lastMask)) {
        await this.applyMask(mask);
        this.lastMask = mask;
        this.phasesSent++;
        if (this.phasesSent % 300 === 0) this.emitState();
      }

      // Drive the lyre's response-speed channel (mechanical movement speed).
      this.applyLyreSpeed();
      // Move the lyre to follow the active group(s) on the front wall.
      // Updates lyreMoveEndAt so blackout-during-move can kick in below.
      this.applyLyrePanTilt(mask);
      // Open shutter (or close it if the lyre is still flying to its new target).
      this.applyShutterOpen();
      // If the lyre is in transit, override its dimmer to 0 (the pattern mask may
      // have set it to 255 above; blackout wins).
      this.applyLyreBlackoutDuringMove();

      const min = this.config.intervalMinMs;
      const max = Math.max(min, this.config.intervalMaxMs);
      const delay = Math.round(min + Math.random() * (max - min));
      this.scheduleNext(delay);
    } catch (err) {
      this.logger.error({ err }, "Dance tick failed");
      this.scheduleNext(500);
    }
  }
}

// ----- patterns -----

type PatternEntry = {
  id: DancePatternId;
  weight: number;
  build: (n: number, names: string[]) => boolean[][];
};

const patternChase = (n: number) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => j === i));
const patternReverseChase = (n: number) => patternChase(n).reverse();
const patternPingPong = (n: number) => {
  if (n <= 1) return patternChase(n);
  return [...patternChase(n), ...patternChase(n).slice(1, -1).reverse()];
};
const patternAlternate = (n: number) => {
  const a = Array.from({ length: n }, (_, i) => i % 2 === 0);
  const b = a.map((v) => !v);
  return [a, b, a, b];
};
const patternRandomSubset = (n: number) =>
  Array.from({ length: 6 }, () => {
    const mask = Array.from({ length: n }, () => Math.random() < 0.5);
    if (!mask.some(Boolean)) mask[Math.floor(Math.random() * n)] = true;
    return mask;
  });
const patternAllHit = (n: number) => [Array(n).fill(true), Array(n).fill(false)];

// "True" synchronized strobe: a long burst of all-fixtures-flashing-together so the
// strobe effect is visible as one sustained event before another pattern is picked.
// 8 ON/OFF cycles ≈ 1-2 s of strobing depending on the interval.
const patternStrobeSync = (n: number) => {
  const out: boolean[][] = [];
  const on = Array(n).fill(true);
  const off = Array(n).fill(false);
  for (let i = 0; i < 8; i++) {
    out.push(on);
    out.push(off);
  }
  return out;
};
const patternPairs = (n: number) => {
  const out: boolean[][] = [];
  for (let phase = 0; phase < 2; phase++) {
    out.push(Array.from({ length: n }, (_, i) => Math.floor(i / 2) % 2 === phase));
  }
  return [...out, ...out];
};
const patternWaveLR = (n: number) =>
  Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n }, (_, j) => j === i || j === i - 1)
  );
const patternWaveRL = (n: number) => patternWaveLR(n).map((m) => [...m].reverse());
const patternBookendIn = (n: number) => {
  if (n < 2) return patternChase(n);
  return [
    Array.from({ length: n }, (_, i) => i === 0 || i === n - 1),
    Array.from({ length: n }, (_, i) => i !== 0 && i !== n - 1)
  ];
};
const patternBookendOut = (n: number) => {
  if (n < 3) return patternChase(n);
  return [
    Array.from({ length: n }, (_, i) => i !== 0 && i !== n - 1),
    Array.from({ length: n }, (_, i) => i === 0 || i === n - 1)
  ];
};

const PATTERNS: PatternEntry[] = [
  { id: "chase", weight: 2, build: patternChase },
  { id: "reverseChase", weight: 2, build: patternReverseChase },
  { id: "pingPong", weight: 2, build: patternPingPong },
  { id: "waveLR", weight: 3, build: patternWaveLR },
  { id: "waveRL", weight: 3, build: patternWaveRL },
  { id: "alternate", weight: 1, build: patternAlternate },
  { id: "pairs", weight: 1, build: patternPairs },
  { id: "randomSubset", weight: 2, build: patternRandomSubset },
  { id: "allHit", weight: 1, build: patternAllHit },
  { id: "strobeSync", weight: 3, build: patternStrobeSync },
  { id: "bookendIn", weight: 2, build: patternBookendIn },
  { id: "bookendOut", weight: 1, build: patternBookendOut }
];

function pickPattern(
  enabled: DancePatternId[],
  n: number,
  names: string[]
): { name: DancePatternId; steps: boolean[][] } {
  const allowed = PATTERNS.filter((p) => enabled.includes(p.id));
  const pool = allowed.length > 0 ? allowed : PATTERNS;
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    if ((r -= p.weight) <= 0) {
      return { name: p.id, steps: p.build(n, names) };
    }
  }
  return { name: pool[0].id, steps: pool[0].build(n, names) };
}

function masksEqual(a: boolean[], b: boolean[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp8(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(255, v));
}

/** HSV (h:0-360, s:0-100, v:0-100) → RGB 0-255. */
function hsvToRgb255(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const vn = Math.max(0, Math.min(100, v)) / 100;
  const hh = ((h % 360) + 360) % 360;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}
