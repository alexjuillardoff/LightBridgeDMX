import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  Fixture,
  FixtureSchema,
  Preset,
  PresetSchema,
  Scene,
  SceneSchema
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
};

function deserializeFixture(row: DbFixture): Fixture {
  return FixtureSchema.parse({
    id: row.id,
    name: row.name,
    address: row.address,
    universe: row.universe,
    channels: JSON.parse(row.channels),
    createdAt: row.createdAt,
    ...(row.profile ? { profile: JSON.parse(row.profile) } : {}),
    ...(row.homekit ? { homekit: JSON.parse(row.homekit) } : {})
  });
}

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
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null
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
        homekit: parsed.homekit ? JSON.stringify(parsed.homekit) : null
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
