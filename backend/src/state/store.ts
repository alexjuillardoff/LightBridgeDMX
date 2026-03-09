import { randomUUID } from "node:crypto";
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

export class Store {
  private fixtures = new Map<string, Fixture>();
  private scenes = new Map<string, Scene>();
  private presets = new Map<string, Preset>();

  listFixtures(): Fixture[] {
    return Array.from(this.fixtures.values());
  }

  getFixture(id: string): Fixture | undefined {
    return this.fixtures.get(id);
  }

  createFixture(input: FixtureInput): Fixture {
    this.assertChannelAvailability(input);
    const now = new Date().toISOString();
    const payload: Fixture = {
      id: input.id ?? randomUUID(),
      createdAt: now,
      ...input
    };

    const parsed = FixtureSchema.parse(payload);
    this.fixtures.set(parsed.id, parsed);
    return parsed;
  }

  updateFixture(id: string, patch: FixtureUpdate): Fixture {
    const existing = this.fixtures.get(id);
    if (!existing) throw new StoreError("Fixture not found", 404);

    const next: Fixture = {
      ...existing,
      ...patch
    };

    this.assertChannelAvailability(next, id);
    const parsed = FixtureSchema.parse(next);
    this.fixtures.set(id, parsed);
    return parsed;
  }

  deleteFixture(id: string) {
    this.fixtures.delete(id);
  }

  listScenes(): Scene[] {
    return Array.from(this.scenes.values());
  }

  createScene(input: Omit<Scene, "id"> & { id?: string }): Scene {
    const scene: Scene = {
      id: input.id ?? randomUUID(),
      ...input
    };
    const parsed = SceneSchema.parse(scene);
    this.scenes.set(parsed.id, parsed);
    return parsed;
  }

  getScene(id: string): Scene | undefined {
    return this.scenes.get(id);
  }

  deleteScene(id: string) {
    this.scenes.delete(id);
  }

  listPresets(): Preset[] {
    return Array.from(this.presets.values());
  }

  createPreset(input: Omit<Preset, "id"> & { id?: string }): Preset {
    const preset: Preset = {
      id: input.id ?? randomUUID(),
      ...input
    };
    const parsed = PresetSchema.parse(preset);
    this.presets.set(parsed.id, parsed);
    return parsed;
  }

  deletePreset(id: string) {
    this.presets.delete(id);
  }

  private assertChannelAvailability(fixture: FixtureInput, ignoreId?: string) {
    const ranges = this.computeRanges(fixture);
    for (const existing of this.fixtures.values()) {
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
