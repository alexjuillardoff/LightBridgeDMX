// Parties pures du playback : rangement des executors et des pools de presets.
import { describe, expect, it } from "vitest";
import type { Preset, Scene } from "@lightbridgedmx/shared";
import { EXECUTOR_SLOTS, PRESET_SLOTS, presetLabel, resolveExecutors, resolvePresetPool } from "./playback";

const scene = (n: number): Scene => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `S${n}`, steps: [] });
const preset = (n: number): Preset => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `P${n}`, payload: {} });

describe("resolveExecutors", () => {
  it("place les affectations explicites puis les orphelines dans les slots libres", () => {
    const scenes = [scene(1), scene(2), scene(3)];
    const slots = resolveExecutors(scenes, { 3: scene(2).id, 1: scene(3).id });
    expect(slots.length).toBe(EXECUTOR_SLOTS);
    expect(slots[0]?.name).toBe("S3");
    expect(slots[1]?.name).toBe("S1"); // orpheline → premier slot libre
    expect(slots[2]?.name).toBe("S2");
    expect(slots[3]).toBeNull();
  });

  it("ignore une affectation vers une scène disparue ou un slot hors pool", () => {
    const slots = resolveExecutors([scene(1)], { 2: "inconnue", 99: scene(1).id });
    expect(slots[0]?.name).toBe("S1");
    expect(slots[1]).toBeNull();
  });
});

describe("resolvePresetPool", () => {
  it("respecte les références par pool, et range les orphelins dans All", () => {
    const presets = [preset(1), preset(2), preset(3)];
    const refs = [
      { id: preset(1).id, pool: "color" as const, slot: 2 },
      { id: preset(2).id, pool: "dimmer" as const, slot: 1 }
    ];
    const color = resolvePresetPool("color", presets, refs);
    expect(color.length).toBe(PRESET_SLOTS);
    expect(color[1]?.name).toBe("P1");
    expect(color[0]).toBeNull();
    const all = resolvePresetPool("all", presets, refs);
    expect(all[0]?.name).toBe("P3");
    expect(all[1]).toBeNull();
  });

  it("presetLabel", () => {
    expect(presetLabel("color", 1)).toBe("Preset 4.1");
    expect(presetLabel("all", 3)).toBe("Preset 3");
  });
});
