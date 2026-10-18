import { describe, expect, it } from "vitest";
import type { Scene } from "@lightbridgedmx/shared";
import { applySceneAtLevel, captureScene, sceneChannels, sceneDimmableChannels } from "./scenes";
import { makeFixture } from "./test-fixtures";

const par = makeFixture({ name: "PAR", address: 1, caps: ["r", "g", "b", "color"] });
const lyre = makeFixture({ name: "Lyre", address: 10, caps: ["pan", "tilt", "intensity", "gobo"] });
const chambre = makeFixture({ name: "PAR chambre", address: 20, caps: ["r", "g", "b"], room: "chambre" });
const byId = new Map([par, lyre, chambre].map((f) => [f.id, f]));

const values = new Array(512).fill(0);
values[0] = 255; values[1] = 100; values[2] = 0; values[3] = 7; // PAR
values[9] = 128; values[10] = 64; values[11] = 200; values[12] = 3; // Lyre
values[19] = 255; // chambre

describe("scenes — capture", () => {
  it("photographie le bloc contigu de chaque projecteur, verrouillés exclus", () => {
    const steps = captureScene([par, lyre, chambre], values);
    expect(steps).toEqual([
      { fixtureId: par.id, values: [255, 100, 0, 7] },
      { fixtureId: lyre.id, values: [128, 64, 200, 3] }
    ]);
  });
});

describe("scenes — rejeu à niveau", () => {
  const scene: Scene = {
    id: "00000000-0000-4000-8000-000000000999",
    name: "test",
    steps: [
      { fixtureId: par.id, values: [255, 100, 0, 7] },
      { fixtureId: lyre.id, values: [128, 64, 200, 3] },
      { fixtureId: chambre.id, values: [255, 255, 255] }
    ]
  };

  it("à 100 % rejoue tel quel, sans la chambre", () => {
    const entries = applySceneAtLevel(scene, byId, 1);
    expect(entries).toEqual([[1, 255], [2, 100], [3, 0], [4, 7], [10, 128], [11, 64], [12, 200], [13, 3]]);
  });

  it("à 50 % n'atténue que les canaux DIMMABLE (la lyre garde pan/tilt/gobo)", () => {
    const entries = applySceneAtLevel(scene, byId, 0.5);
    expect(entries).toEqual([[1, 128], [2, 50], [3, 0], [4, 7], [10, 128], [11, 64], [12, 100], [13, 3]]);
  });

  it("sceneChannels et sceneDimmableChannels", () => {
    expect(sceneChannels(scene, byId)).toEqual([1, 2, 3, 4, 10, 11, 12, 13]);
    expect(sceneDimmableChannels(scene, byId)).toEqual([1, 2, 3, 12]);
  });

  it("ignore un projecteur disparu du patch", () => {
    const orphan: Scene = { ...scene, steps: [{ fixtureId: "ffffffff-ffff-4fff-8fff-ffffffffffff", values: [1, 2] }] };
    expect(applySceneAtLevel(orphan, byId, 1)).toEqual([]);
  });
});
