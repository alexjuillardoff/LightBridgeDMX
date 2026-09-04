import { describe, expect, it } from "vitest";
// Code teste : packages/shared/src/effect-cells.ts (voir engine.spec.ts).
import type { Fixture, SmartLight } from "@lightbridgedmx/shared";
import { resolveCells } from "@lightbridgedmx/shared";

const fixture = (over: Partial<Fixture> & Pick<Fixture, "id" | "name" | "address" | "channels">): Fixture =>
  ({ universe: 0, ...over }) as Fixture;

const par = fixture({
  id: "par-1",
  name: "PAR 56",
  address: 1,
  channels: [
    { channel: 1, capability: "intensity" },
    { channel: 2, capability: "r" },
    { channel: 3, capability: "g" },
    { channel: 4, capability: "b" }
  ]
});

const lyre = fixture({
  id: "lyre-1",
  name: "MH-X20",
  address: 13,
  channels: [
    { channel: 1, capability: "pan" },
    { channel: 3, capability: "tilt" },
    { channel: 6, capability: "intensity" }
  ]
});

const stripFixture = fixture({
  id: "strip-fx",
  name: "Bandeau LED",
  address: 108,
  channels: []
});

const strip = {
  id: "light-1",
  name: "Bandeau",
  backend: "nanoleaf-http",
  dmxMirror: { zones: { universe: 0, startChannel: 108, zoneCount: 3, fixtureId: "strip-fx" } }
} as unknown as SmartLight;

describe("resolveCells", () => {
  it("donne une cellule par projecteur classique, canaux absolus", () => {
    const cells = resolveCells(["par-1"], [par], []);
    expect(cells).toHaveLength(1);
    // Adresse 1 + canal relatif 2 - 1 = canal absolu 2.
    expect(cells[0].channels).toEqual({ dimmer: 1, red: 2, green: 3, blue: 4 });
  });

  it("resout pan/tilt d'une lyre a la bonne adresse", () => {
    const [cell] = resolveCells(["lyre-1"], [lyre], []);
    expect(cell.channels.pan).toBe(13);
    expect(cell.channels.tilt).toBe(15);
    expect(cell.channels.dimmer).toBe(18);
  });

  it("developpe un bandeau en une cellule par zone", () => {
    const cells = resolveCells(["strip-fx"], [stripFixture], [strip]);
    expect(cells).toHaveLength(3);
    expect(cells[0].channels).toEqual({ red: 108, green: 109, blue: 110 });
    expect(cells[2].channels).toEqual({ red: 114, green: 115, blue: 116 });
    // Pas de canal d'intensite par zone : le dimmer master est unique pour tout le
    // bandeau, une ligne "dimmer" se resoudra donc en fondu de couleur.
    expect(cells[0].channels.dimmer).toBeUndefined();
  });

  it("respecte l'ordre de selection — c'est lui qui porte la phase", () => {
    const cells = resolveCells(["lyre-1", "par-1"], [par, lyre], []);
    expect(cells.map((c) => c.fixtureId)).toEqual(["lyre-1", "par-1"]);
  });

  it("saute les zones spare pour qu'elles ne mangent pas une tranche de phase", () => {
    const withSpare = {
      ...strip,
      zoneLayout: {
        segments: Array.from({ length: 3 }, () => ({
          start: { x: 0, y: 0, z: 0 },
          end: { x: 1, y: 0, z: 0 }
        })),
        spareZones: [1]
      }
    } as unknown as SmartLight;
    const cells = resolveCells(["strip-fx"], [stripFixture], [withSpare]);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.cellIndex)).toEqual([0, 2]);
  });

  it("ignore un projecteur sans aucun attribut modulable", () => {
    const dumb = fixture({ id: "x", name: "Fumigene", address: 200, channels: [{ channel: 1, capability: "effect" }] });
    expect(resolveCells(["x"], [dumb], [])).toHaveLength(0);
  });

  it("ignore un id inconnu au lieu de casser", () => {
    expect(resolveCells(["nope"], [par], [])).toHaveLength(0);
  });
});
