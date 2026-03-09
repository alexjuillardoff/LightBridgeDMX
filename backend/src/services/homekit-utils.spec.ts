import { describe, expect, it } from "vitest";
import { Fixture } from "@lightbridgedmx/shared";
import { collectHomeKitLights, hsbToRgb, resolveRgbChannels, rgbToHsb } from "./homekit-utils";

const baseFixture: Fixture = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "RGB Fixture",
  address: 1,
  universe: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  channels: [
    { channel: 1, capability: "r" },
    { channel: 2, capability: "g" },
    { channel: 3, capability: "b" }
  ]
};

describe("color conversion", () => {
  it("converts HSB primaries to RGB", () => {
    expect(hsbToRgb({ hue: 0, saturation: 100, brightness: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsbToRgb({ hue: 120, saturation: 100, brightness: 100 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsbToRgb({ hue: 240, saturation: 100, brightness: 100 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("extracts HSB from RGB", () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 100, brightness: 100 });
    expect(rgbToHsb({ r: 255, g: 255, b: 255 })).toEqual({ hue: 0, saturation: 0, brightness: 100 });
    const mixed = rgbToHsb({ r: 64, g: 128, b: 255 });
    const back = hsbToRgb(mixed);
    expect(back.r).toBeGreaterThan(50);
    expect(back.b).toBeGreaterThan(back.r);
  });
});

describe("DMX channel resolution", () => {
  it("infers RGB mapping from capabilities", () => {
    const mapping = resolveRgbChannels(baseFixture);
    expect(mapping).toEqual({ r: 1, g: 2, b: 3, universe: 0, source: "capability", address: 1 });
  });

  it("uses explicit HomeKit dmxChannels when provided", () => {
    const fixture: Fixture = {
      ...baseFixture,
      address: 10,
      homekit: { dmxChannels: { r: 2, g: 3, b: 5 } }
    };
    const mapping = resolveRgbChannels(fixture);
    expect(mapping).toEqual({ r: 11, g: 12, b: 14, universe: 0, source: "config", address: 10 });
  });

  it("skips fixtures that are not RGB-capable", () => {
    const fixtures: Fixture[] = [
      baseFixture,
      {
        ...baseFixture,
        id: "00000000-0000-0000-0000-000000000002",
        channels: [{ channel: 1, capability: "intensity" }]
      }
    ];
    const { lights, skipped } = collectHomeKitLights(fixtures);
    expect(lights).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ fixtureId: fixtures[1].id });
  });
});
