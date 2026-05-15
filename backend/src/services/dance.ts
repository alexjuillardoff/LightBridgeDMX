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

const PAN_TILT_CAPS: ReadonlySet<Capability> = new Set<Capability>(["pan", "tilt"]);

type FixtureGroup = {
  name: string;
  fixtureId: string;
  channels: { channel: number; value: number }[];
};

export class DanceService extends EventEmitter {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly store: Store;
  private config: DanceConfig | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private currentPattern: boolean[][] | null = null;
  private currentPatternName: DancePatternId | null = null;
  private stepIdx = 0;
  private lastMask: boolean[] | null = null;
  private groups: FixtureGroup[] = [];
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

  constructor(logger: FastifyBaseLogger, dmx: DmxService, store: Store) {
    super();
    this.logger = logger.child({ service: "dance" });
    this.dmx = dmx;
    this.store = store;
  }

  async init(): Promise<void> {
    this.config = await this.store.getDanceConfig();
    await this.autoseedLyrePositions();
    if (this.config.enabled) {
      this.logger.info("Resuming Dance mode from persisted config");
      await this.start();
    }
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
    this.config = await this.store.saveDanceConfig(next);
    if (this.running) {
      // Refresh active groups to apply room/exclusion/lyre changes immediately.
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
    await this.refreshGroups({ force: true });
    this.scheduleNext(0);
    this.logger.info({ groups: this.groups.length }, "Dance started");
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
    const byFixture = new Map<string, FixtureGroup>();
    for (const [abs, { value, fixtureId }] of this.rememberedSnapshot) {
      const meta = channelMeta.get(abs);
      if (!meta) continue;
      if (!byFixture.has(fixtureId)) {
        byFixture.set(fixtureId, { name: meta.fixtureName, fixtureId, channels: [] });
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
          name: lyre.name,
          fixtureId: lyre.fixtureId,
          channels: [{ channel: lyre.dimmerChannel, value: dimmerOn }]
        });
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
    this.groups.forEach((g, i) => {
      const on = mask[i];
      for (const { channel, value } of g.channels) {
        this.dmx.setChannel(channel, on ? value : 0);
      }
    });
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
