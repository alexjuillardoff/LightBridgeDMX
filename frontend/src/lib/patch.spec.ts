import { describe, expect, it } from "vitest";
import type { SmartLight } from "@lightbridgedmx/shared";
import {
  absoluteChannel,
  buildPatch,
  byFid,
  channelsFor,
  detectZones,
  dimmableChannels,
  facadeIds,
  fixtureOf,
  getPatch,
  lockedChannels,
  patchIndex
} from "./patch";
import { makeFixture, makeStrip } from "./test-fixtures";

const lyre = makeFixture({ name: "Lyre", address: 13, caps: ["pan", "tilt", "intensity"], profile: { source: "qxf", manufacturer: "X", model: "Y", mode: "3ch" } });
const par = makeFixture({ name: "PAR", address: 1, caps: ["r", "g", "b"] });
const strip = makeStrip("Bandeau", 108, 50);
const bulb = makeFixture({ name: "Lampe", address: 259, caps: ["intensity", "r", "g", "b", "colorTemp"] });
const chambre = makeFixture({ name: "PAR", address: 30, caps: ["r", "g", "b"], room: "chambre" });

describe("patch — construction", () => {
  const patch = buildPatch([strip, lyre, bulb, chambre, par]);

  it("trie par (universe, address) et numérote les FID", () => {
    expect(patch.map((f) => [f.fid, f.name])).toEqual([[1, "PAR"], [2, "Lyre"], [3, "PAR"], [4, "Bandeau"], [5, "Lampe"]]);
    expect(byFid(patch, 2)?.name).toBe("Lyre");
    expect(byFid(patch, 99)).toBeUndefined();
  });

  it("calcule span, zones, verrou, façade", () => {
    const s = byFid(patch, 4);
    expect(s?.span).toBe(151);
    expect(s?.subCount).toBe(50);
    expect(s?.isFacade).toBe(true);
    expect(byFid(patch, 1)?.subCount).toBe(0);
    expect(byFid(patch, 5)?.isFacade).toBe(true);
    expect(byFid(patch, 2)?.isFacade).toBe(false);
    expect(byFid(patch, 3)?.locked).toContain("Pièce protégée");
    expect(byFid(patch, 1)?.locked).toBeNull();
  });

  it("fixtureOf retrouve le propriétaire d'un canal (bloc contigu)", () => {
    expect(fixtureOf(patch, 1)?.name).toBe("PAR");
    expect(fixtureOf(patch, 15)?.name).toBe("Lyre");
    expect(fixtureOf(patch, 258)?.name).toBe("Bandeau");
    expect(fixtureOf(patch, 500)).toBeUndefined();
  });

  it("dimmableChannels exclut les verrouillés et les non atténuables", () => {
    const dim = dimmableChannels(patch);
    expect(dim.has(1)).toBe(true);
    expect(dim.has(13)).toBe(false); // pan
    expect(dim.has(15)).toBe(true); // intensity lyre
    expect(dim.has(30)).toBe(false); // chambre
    expect(dim.has(263)).toBe(false); // colorTemp
    expect(dim.size).toBe(3 + 1 + 151 + 4);
  });

  it("lockedChannels couvre tout le bloc des projecteurs verrouillés", () => {
    expect([...lockedChannels(patch)]).toEqual([30, 31, 32]);
  });

  it("patchIndex est caché par identité du patch", () => {
    expect(patchIndex(patch)).toBe(patchIndex(patch));
    expect(patchIndex(patch).get(par.id)?.fid).toBe(1);
  });
});

describe("patch — helpers", () => {
  it("absoluteChannel et channelsFor bornent à l'univers", () => {
    expect(absoluteChannel(lyre, 3)).toBe(15);
    expect(channelsFor(lyre, "pan")).toEqual([13]);
    const edge = makeFixture({ name: "Edge", address: 511, caps: ["r", "g", "b"] });
    expect(channelsFor(edge, "b")).toEqual([]);
  });

  it("detectZones exige au moins 3 triplets contigus", () => {
    expect(detectZones(makeStrip("s", 1, 2))).toBe(0);
    expect(detectZones(makeStrip("s", 1, 3))).toBe(3);
    expect(detectZones(makeFixture({ name: "x", address: 1, caps: ["r", "g", "b", "r", "g", "b", "w", "r", "g", "b"] }))).toBe(0);
  });

  it("facadeIds suit la règle du backend (zones.fixtureId, puis canaux du miroir uniforme)", () => {
    const lights: SmartLight[] = [
      {
        id: "00000000-0000-4000-8000-00000000aaaa",
        name: "IML",
        backend: "nanoleaf-http",
        config: { type: "nanoleaf-http", host: "1.2.3.4" },
        dmxMirror: { zones: { startChannel: 108, zoneCount: 50, fixtureId: strip.id } },
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "00000000-0000-4000-8000-00000000bbbb",
        name: "Lampe",
        backend: "homekit-thread",
        config: { type: "homekit-thread", alias: "lampe" },
        dmxMirror: { rChannel: 260, gChannel: 261, bChannel: 262, briChannel: 259 },
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    const ids = facadeIds([strip, bulb, par], lights);
    expect(ids).toEqual(new Set([strip.id, bulb.id]));
  });

  it("getPatch renvoie la même référence tant que rien ne change", () => {
    const fixtures = [par, lyre];
    const a = getPatch(fixtures, []);
    const b = getPatch(fixtures, []);
    expect(a).toBe(b);
    expect(getPatch([par], [])).not.toBe(a);
  });
});
