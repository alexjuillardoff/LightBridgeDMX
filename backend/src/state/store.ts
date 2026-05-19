import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  DanceConfig,
  DanceConfigSchema,
  Fixture,
  FixtureSchema,
  Preset,
  PresetSchema,
  Scene,
  SceneSchema,
  SmartLight,
  SmartLightInput,
  SmartLightSchema
} from "@lightbridgedmx/shared";

export class StoreError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export type FixtureInput = Omit<Fixture, "id" | "createdAt"> & { id?: string };
export type FixtureUpdate = Partial<FixtureInput>;

type DbFixture = {
  id: string;
  name: string;
  address: number;
  universe: number;
  channels: string;
  createdAt: string;
  profile: string | null;
  homekit: string | null;
  room: string | null;
};

type DbSmartLight = {
  id: string;
  name: string;
  room: string | null;
  backend: string;
  config: string;
  dmxMirror: string | null;
  streaming: string | null;
  zoneLayout: string | null;
  currentEffect: string | null;
  createdAt: string;
};

function deserializeSmartLight(row: DbSmartLight): SmartLight {
  return SmartLightSchema.parse({
    id: row.id,
    name: row.name,
    backend: row.backend,
    config: JSON.parse(row.config),
    createdAt: row.createdAt,
    ...(row.room ? { room: row.room } : {}),
    ...(row.dmxMirror ? { dmxMirror: JSON.parse(row.dmxMirror) } : {}),
    ...(row.streaming ? { streaming: JSON.parse(row.streaming) } : {}),
    ...(row.zoneLayout ? { zoneLayout: JSON.parse(row.zoneLayout) } : {}),
    ...(row.currentEffect ? { currentEffect: JSON.parse(row.currentEffect) } : {})
  });
}

function deserializeFixture(row: DbFixture): Fixture {
  return FixtureSchema.parse({
    id: row.id,
    name: row.name,
    address: row.address,
    universe: row.universe,
    channels: JSON.parse(row.channels),
    createdAt: row.createdAt,
    ...(row.profile ? { profile: JSON.parse(row.profile) } : {}),
    ...(row.homekit ? { homekit: JSON.parse(row.homekit) } : {}),
    ...(row.room ? { room: row.room } : {})
  });
}

const DEFAULT_DANCE_CONFIG: Omit<DanceConfig, "updatedAt"> = {
  enabled: false,
  rooms: [],
  intervalMinMs: 55,
  intervalMaxMs: 140,
  patterns: [
    "chase",
    "reverseChase",
    "pingPong",
    "waveLR",
    "waveRL",
    "alternate",
    "pairs",
    "randomSubset",
    "allHit",
    "strobeSync"
  ],
  excludePanTilt: true,
  excludeCapabilities: [],
  lyre: {
    enabled: false,
    shutterOpenValue: 255,
    dimmerOnValue: 255,
    followChase: false,
    positions: [],
    wallEdgeRight: { pan: 20, tilt: 9 },
    speedValue: 0,
    msPerPanUnit: 40
  }
};

export class Store {
  private prisma = new PrismaClient();

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async listFixtures(): Promise<Fixture[]> {
    const rows = await this.prisma.fixture.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(deserializeFixture);
  }

  async getFixture(id: string): Promise<Fixture | undefined> {
    const row = await this.prisma.fixture.findUnique({ where: { id } });
    return row ? deserializeFixture(row) : undefined;
  }

  async createFixture(input: FixtureInput): Promise<Fixture> {
    await this.assertChannelAvailability(input);
    const now = new Date().toISOString();
    const payload: Fixture = {
      id: input.id ?? randomUUID(),
      createdAt: now,
      ...input
    };
    const parsed = FixtureSchema.parse(payload);
    await this.prisma.fixture.create({
      data: {
        id: parsed.id,
        name: parsed.name,
        address: parsed.address,
        universe: parsed.universe,
        channels: JSON.stringify(parsed.channels),
        createdAt: parsed.createdAt,
        profile: parsed.profile ? JSON.stringify(parsed.profile) : null,
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null,
        room: parsed.room ?? null
      }
    });
    return parsed;
  }

  async updateFixture(id: string, patch: FixtureUpdate): Promise<Fixture> {
    const existing = await this.getFixture(id);
    if (!existing) throw new StoreError("Fixture not found", 404);
    const next: Fixture = { ...existing, ...patch };
    await this.assertChannelAvailability(next, id);
    const parsed = FixtureSchema.parse(next);
    await this.prisma.fixture.update({
      where: { id },
      data: {
        name: parsed.name,
        address: parsed.address,
        universe: parsed.universe,
        channels: JSON.stringify(parsed.channels),
        profile: parsed.profile ? JSON.stringify(parsed.profile) : null,
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null,
        room: parsed.room ?? null
      }
    });
    return parsed;
  }

  async deleteFixture(id: string): Promise<void> {
    await this.prisma.fixture.delete({ where: { id } }).catch(() => {});
  }

  async listScenes(): Promise<Scene[]> {
    const rows = await this.prisma.scene.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => SceneSchema.parse({ ...row, steps: JSON.parse(row.steps) }));
  }

  async getScene(id: string): Promise<Scene | undefined> {
    const row = await this.prisma.scene.findUnique({ where: { id } });
    return row ? SceneSchema.parse({ ...row, steps: JSON.parse(row.steps) }) : undefined;
  }

  async createScene(input: Omit<Scene, "id"> & { id?: string }): Promise<Scene> {
    const scene: Scene = { id: input.id ?? randomUUID(), ...input };
    const parsed = SceneSchema.parse(scene);
    await this.prisma.scene.create({
      data: { id: parsed.id, name: parsed.name, steps: JSON.stringify(parsed.steps) }
    });
    return parsed;
  }

  async deleteScene(id: string): Promise<void> {
    await this.prisma.scene.delete({ where: { id } }).catch(() => {});
  }

  async listPresets(): Promise<Preset[]> {
    const rows = await this.prisma.preset.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => PresetSchema.parse({ ...row, payload: JSON.parse(row.payload) }));
  }

  async createPreset(input: Omit<Preset, "id"> & { id?: string }): Promise<Preset> {
    const preset: Preset = { id: input.id ?? randomUUID(), ...input };
    const parsed = PresetSchema.parse(preset);
    await this.prisma.preset.create({
      data: { id: parsed.id, name: parsed.name, payload: JSON.stringify(parsed.payload) }
    });
    return parsed;
  }

  async deletePreset(id: string): Promise<void> {
    await this.prisma.preset.delete({ where: { id } }).catch(() => {});
  }

  async getDanceConfig(): Promise<DanceConfig> {
    const row = await this.prisma.danceConfig.findUnique({ where: { id: "singleton" } });
    if (!row) {
      const seeded = await this.saveDanceConfig({
        ...DEFAULT_DANCE_CONFIG,
        updatedAt: new Date().toISOString()
      });
      return seeded;
    }
    return DanceConfigSchema.parse({
      enabled: row.enabled,
      rooms: JSON.parse(row.rooms),
      intervalMinMs: row.intervalMinMs,
      intervalMaxMs: row.intervalMaxMs,
      patterns: JSON.parse(row.patterns),
      excludePanTilt: row.excludePanTilt,
      excludeCapabilities: JSON.parse(row.excludeCapabilities),
      lyre: JSON.parse(row.lyre),
      updatedAt: row.updatedAt
    });
  }

  async saveDanceConfig(config: DanceConfig): Promise<DanceConfig> {
    const parsed = DanceConfigSchema.parse({
      ...config,
      updatedAt: new Date().toISOString()
    });
    if (parsed.intervalMinMs > parsed.intervalMaxMs) {
      throw new StoreError("intervalMinMs must be <= intervalMaxMs", 400);
    }
    const data = {
      enabled: parsed.enabled,
      rooms: JSON.stringify(parsed.rooms),
      intervalMinMs: parsed.intervalMinMs,
      intervalMaxMs: parsed.intervalMaxMs,
      patterns: JSON.stringify(parsed.patterns),
      excludePanTilt: parsed.excludePanTilt,
      excludeCapabilities: JSON.stringify(parsed.excludeCapabilities),
      lyre: JSON.stringify(parsed.lyre),
      updatedAt: parsed.updatedAt
    };
    await this.prisma.danceConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data
    });
    return parsed;
  }

  async listSmartLights(): Promise<SmartLight[]> {
    const rows = await this.prisma.smartLight.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(deserializeSmartLight);
  }

  async getSmartLight(id: string): Promise<SmartLight | undefined> {
    const row = await this.prisma.smartLight.findUnique({ where: { id } });
    return row ? deserializeSmartLight(row) : undefined;
  }

  async createSmartLight(input: SmartLightInput): Promise<SmartLight> {
    const now = new Date().toISOString();
    const parsed = SmartLightSchema.parse({
      id: input.id ?? randomUUID(),
      createdAt: now,
      ...input
    });
    await this.prisma.smartLight.create({
      data: {
        id: parsed.id,
        name: parsed.name,
        room: parsed.room ?? null,
        backend: parsed.backend,
        config: JSON.stringify(parsed.config),
        dmxMirror: parsed.dmxMirror ? JSON.stringify(parsed.dmxMirror) : null,
        streaming: parsed.streaming ? JSON.stringify(parsed.streaming) : null,
        zoneLayout: parsed.zoneLayout ? JSON.stringify(parsed.zoneLayout) : null,
        currentEffect: parsed.currentEffect ? JSON.stringify(parsed.currentEffect) : null,
        createdAt: parsed.createdAt
      }
    });
    return parsed;
  }

  async updateSmartLight(id: string, patch: Partial<SmartLightInput>): Promise<SmartLight> {
    const existing = await this.getSmartLight(id);
    if (!existing) throw new StoreError("Smart light not found", 404);
    const next: SmartLight = { ...existing, ...patch };
    const parsed = SmartLightSchema.parse(next);
    await this.prisma.smartLight.update({
      where: { id },
      data: {
        name: parsed.name,
        room: parsed.room ?? null,
        backend: parsed.backend,
        config: JSON.stringify(parsed.config),
        dmxMirror: parsed.dmxMirror ? JSON.stringify(parsed.dmxMirror) : null,
        streaming: parsed.streaming ? JSON.stringify(parsed.streaming) : null,
        zoneLayout: parsed.zoneLayout ? JSON.stringify(parsed.zoneLayout) : null,
        currentEffect: parsed.currentEffect ? JSON.stringify(parsed.currentEffect) : null
      }
    });
    return parsed;
  }

  async deleteSmartLight(id: string): Promise<void> {
    await this.prisma.smartLight.delete({ where: { id } }).catch(() => {});
  }

  async listRooms(): Promise<string[]> {
    const [fixtureRows, smartRows] = await Promise.all([
      this.prisma.fixture.findMany({
        where: { room: { not: null } },
        select: { room: true }
      }),
      this.prisma.smartLight.findMany({
        where: { room: { not: null } },
        select: { room: true }
      })
    ]);
    const set = new Set<string>();
    for (const r of fixtureRows) if (r.room) set.add(r.room);
    for (const r of smartRows) if (r.room) set.add(r.room);
    return [...set].sort();
  }

  async loadUniverseSnapshot(universe = 0): Promise<number[] | null> {
    const row = await this.prisma.universeSnapshot.findUnique({ where: { universe } });
    if (!row) return null;
    const buf = Buffer.from(row.values);
    const out = new Array<number>(512).fill(0);
    for (let i = 0; i < Math.min(buf.length, 512); i++) {
      out[i] = buf[i];
    }
    return out;
  }

  async saveUniverseSnapshot(values: number[], universe = 0): Promise<void> {
    const buf = Buffer.alloc(512);
    for (let i = 0; i < Math.min(values.length, 512); i++) {
      const v = values[i];
      buf[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
    }
    const updatedAt = new Date().toISOString();
    await this.prisma.universeSnapshot.upsert({
      where: { universe },
      create: { universe, values: buf, updatedAt },
      update: { values: buf, updatedAt }
    });
  }

  private async assertChannelAvailability(fixture: FixtureInput, ignoreId?: string): Promise<void> {
    const all = await this.listFixtures();
    const ranges = this.computeRanges(fixture);
    for (const existing of all) {
      if (existing.id === ignoreId) continue;
      const existingRanges = this.computeRanges(existing);
      if (ranges.some((channel) => existingRanges.includes(channel))) {
        throw new StoreError("DMX channel overlap detected", 409);
      }
    }
  }

  private computeRanges(fixture: Pick<Fixture, "address" | "channels">): number[] {
    return fixture.channels.map((ch) => fixture.address + ch.channel - 1);
  }
}
