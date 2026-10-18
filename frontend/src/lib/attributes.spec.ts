import { describe, expect, it } from "vitest";
import {
  attrsOfGroup,
  channelsForAttr,
  formatValue,
  groupsAvailable,
  hasAttr,
  parseNaturalValue,
  readAttr
} from "./attributes";
import { makeFixture } from "./test-fixtures";

const parRgb = makeFixture({ name: "PAR RGB", address: 1, caps: ["r", "g", "b", "color", "speed", "maintenance"] });
const parRgbw = makeFixture({ name: "PAR RGBW", address: 25, caps: ["r", "g", "b", "w", "effect", "speed", "maintenance", "intensity"] });
const lyre = makeFixture({ name: "Lyre", address: 13, caps: ["pan", "tilt", "pan", "tilt", "speed", "color", "strobe", "intensity", "gobo", "maintenance", "effect"] });

describe("attributes — canaux par attribut", () => {
  it("dimmer avec canal intensity → ce canal", () => {
    expect(channelsForAttr(parRgbw, "dimmer")).toEqual([32]);
    expect(channelsForAttr(lyre, "dimmer")).toEqual([20]);
  });

  it("dimmer sans canal intensity retombe sur r+g+b", () => {
    expect(channelsForAttr(parRgb, "dimmer")).toEqual([1, 2, 3]);
  });

  it("pan/tilt renvoient tous les canaux (gros + fin)", () => {
    expect(channelsForAttr(lyre, "pan")).toEqual([13, 15]);
    expect(channelsForAttr(lyre, "tilt")).toEqual([14, 16]);
  });

  it("hasAttr et groupsAvailable", () => {
    expect(hasAttr(parRgb, "pan")).toBe(false);
    expect(hasAttr(parRgb, "dimmer")).toBe(true);
    expect(groupsAvailable([parRgb])).toEqual(new Set(["dimmer", "color", "control"]));
    expect(groupsAvailable([lyre]).has("position")).toBe(true);
    expect(groupsAvailable([lyre]).has("gobo")).toBe(true);
    expect(groupsAvailable([])).toEqual(new Set());
  });

  it("attrsOfGroup suit l'ordre canonique", () => {
    expect(attrsOfGroup("color")).toEqual(["red", "green", "blue", "white", "uv", "ctemp", "colorWheel"]);
    expect(attrsOfGroup("position")).toEqual(["pan", "tilt"]);
    expect(attrsOfGroup("shapers")).toEqual([]);
  });

  it("readAttr = max des canaux (HTP), null si absent", () => {
    const values = new Array(512).fill(0);
    values[0] = 10;
    values[1] = 200;
    values[2] = 50;
    expect(readAttr(parRgb, "dimmer", values)).toBe(200);
    expect(readAttr(parRgb, "pan", values)).toBeNull();
  });
});

describe("attributes — readout", () => {
  it("natural : % pour dimmer/couleur, ° pour pan/tilt, brut pour les roues", () => {
    expect(formatValue(255, "dimmer", "natural")).toBe("100%");
    expect(formatValue(128, "red", "natural")).toBe("50%");
    expect(formatValue(255, "pan", "natural")).toBe("270°");
    expect(formatValue(0, "pan", "natural")).toBe("-270°");
    expect(formatValue(0, "tilt", "natural")).toBe("-135°");
    expect(formatValue(255, "tilt", "natural")).toBe("135°");
    expect(formatValue(42, "gobo", "natural")).toBe("42");
  });

  it("percent et decimal8", () => {
    expect(formatValue(42, "gobo", "percent")).toBe("16%");
    expect(formatValue(42, "pan", "decimal8")).toBe("42");
  });

  it("parseNaturalValue est l'inverse de formatValue", () => {
    expect(parseNaturalValue("50%", "dimmer")).toBe(128);
    expect(parseNaturalValue("0°", "pan")).toBe(128);
    expect(parseNaturalValue("-135", "tilt")).toBe(0);
    expect(parseNaturalValue("12", "gobo")).toBe(12);
    expect(parseNaturalValue("x", "gobo")).toBeNull();
  });
});
