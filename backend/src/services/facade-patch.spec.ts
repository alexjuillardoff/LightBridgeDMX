// Tests du patch automatique des facades DMX : les vrais projecteurs gardent leur
// adresse, les facades des lampes connectees se rangent derriere eux.
import { describe, expect, it } from "vitest";
import type { Fixture, SmartLight } from "@lightbridgedmx/shared";
import {
  FacadeRoomError,
  facadeIds,
  lastRealChannel,
  placeFacade,
  planFacadeMoves,
  realignMirror
} from "./facade-patch";

const fixture = (id: string, address: number, size: number): Fixture =>
  ({
    id,
    name: id,
    address,
    universe: 0,
    createdAt: "",
    channels: Array.from({ length: size }, (_, i) => ({ channel: i + 1, capability: "r" }))
  }) as unknown as Fixture;

/** Le patch de la maison au 2026-10-18 : les ampoules Thread avaient ete glissees
 *  dans le premier trou libre, entre le PAR 56 Lampe et le PAR du bureau. */
const real = [
  fixture("lava", 1, 6),
  fixture("cafe", 7, 6),
  fixture("lyre", 13, 11),
  fixture("par-lampe", 25, 8),
  fixture("par-bureau", 100, 8)
];
const facades = [
  fixture("lampe-canape", 33, 5),
  fixture("plafonnier-canape", 38, 5),
  fixture("plafonnier-cuisine", 43, 5),
  fixture("bandeau", 108, 151)
];
const FACADES = new Set(facades.map((f) => f.id));

describe("planFacadeMoves", () => {
  it("sort les facades glissees entre les vrais projecteurs, et elles seules", () => {
    const moves = planFacadeMoves([...real, ...facades], FACADES);
    // Le bandeau est deja derriere le dernier vrai canal (107) : il ne bouge pas.
    expect(moves).toEqual([
      { id: "lampe-canape", address: 259 },
      { id: "plafonnier-canape", address: 264 },
      { id: "plafonnier-cuisine", address: 269 }
    ]);
  });

  it("ne touche a rien quand tout est deja range", () => {
    const tidy = [
      ...real,
      fixture("bandeau", 108, 151),
      fixture("lampe-canape", 259, 5),
      fixture("plafonnier-canape", 264, 5)
    ];
    expect(planFacadeMoves(tidy, FACADES)).toEqual([]);
  });

  it("un vrai projecteur patche par-dessus une facade la pousse derriere lui", () => {
    const tidy = [...real, fixture("bandeau", 108, 151), fixture("lampe-canape", 259, 5)];
    const moves = planFacadeMoves([...tidy, fixture("nouveau-par", 110, 8)], FACADES);
    // Dernier vrai canal : 117. L'ampoule (259-263) reste bien placee ; le bandeau
    // part a la premiere place libre qui ne recouvre pas son ancienne place.
    expect(moves).toEqual([{ id: "bandeau", address: 264 }]);
  });

  it("evite d'atterrir sur l'ancienne place d'une autre facade qui bouge", () => {
    // Le vrai projecteur 1-31 rattrape les deux facades. La premiere place libre
    // (32) recouvre l'ancienne place de « b » (30-34), que sa lampe lit encore.
    const layout = [fixture("par", 1, 31), fixture("a", 20, 5), fixture("b", 30, 5)];
    const moves = planFacadeMoves(layout, new Set(["a", "b"]));
    expect(moves).toEqual([
      { id: "a", address: 35 },
      { id: "b", address: 40 }
    ]);
  });

  it("separe deux facades qui se chevauchent", () => {
    // « a » garde sa place ; « b » prend la premiere place libre derriere le PAR.
    const layout = [fixture("par", 1, 10), fixture("a", 20, 5), fixture("b", 22, 5)];
    expect(planFacadeMoves(layout, new Set(["a", "b"]))).toEqual([{ id: "b", address: 11 }]);
  });

  it("refuse quand une facade ne tient plus derriere les vrais canaux", () => {
    const layout = [...real, fixture("bandeau", 108, 151), fixture("tout-au-bout", 500, 8)];
    expect(() => planFacadeMoves(layout, FACADES)).toThrow(FacadeRoomError);
  });

  it("range chaque univers pour lui-meme", () => {
    const other = { ...fixture("par-u1", 1, 300), universe: 1 } as Fixture;
    const facadeU1 = { ...fixture("facade-u1", 100, 5), universe: 1 } as Fixture;
    const moves = planFacadeMoves([...real, other, facadeU1], new Set(["facade-u1"]));
    expect(moves).toEqual([{ id: "facade-u1", address: 301 }]);
  });
});

describe("placeFacade", () => {
  const tidy = [...real, fixture("bandeau", 108, 151)];

  it("loge une nouvelle facade derriere les vrais projecteurs, pas dans un trou", () => {
    // 33-99 est libre, mais c'est entre deux projecteurs physiques.
    expect(placeFacade(tidy, FACADES, { size: 5, universe: 0 })).toBe(259);
  });

  it("garde l'adresse demandee si elle respecte la regle", () => {
    expect(placeFacade(tidy, FACADES, { size: 5, universe: 0, preferred: 300 })).toBe(300);
  });

  it("ignore une adresse demandee entre deux vrais projecteurs", () => {
    expect(placeFacade(tidy, FACADES, { size: 5, universe: 0, preferred: 40 })).toBe(259);
  });

  it("laisse une facade redimensionnee a sa place si elle y tient encore", () => {
    expect(
      placeFacade(tidy, FACADES, { size: 160, universe: 0, preferred: 108, ignoreId: "bandeau" })
    ).toBe(108);
  });

  it("renvoie null quand l'univers est plein", () => {
    expect(placeFacade(tidy, FACADES, { size: 300, universe: 0 })).toBeNull();
  });
});

describe("facadeIds / lastRealChannel", () => {
  it("reconnait les facades par leurs canaux (ampoule) ou par leur lien (bandeau)", () => {
    const lights = [
      { id: "thread", dmxMirror: { universe: 0, briChannel: 33, rChannel: 34, gChannel: 35, bChannel: 36 } },
      { id: "strip", dmxMirror: { zones: { startChannel: 108, zoneCount: 50, fixtureId: "bandeau" } } },
      { id: "sans-miroir", dmxMirror: null }
    ] as unknown as SmartLight[];
    const ids = facadeIds(lights, [...real, ...facades]);
    expect([...ids].sort()).toEqual(["bandeau", "lampe-canape"]);
  });

  it("le dernier vrai canal ignore les facades", () => {
    expect(lastRealChannel([...real, ...facades], FACADES, 0)).toBe(107);
    expect(lastRealChannel(facades, FACADES, 0)).toBe(0);
  });
});

describe("realignMirror", () => {
  it("decale le miroir uniforme d'une ampoule avec sa facade", () => {
    const before = fixture("lampe-canape", 33, 5);
    const after = { ...before, address: 259 };
    const mirror = { universe: 0, briChannel: 33, rChannel: 34, gChannel: 35, bChannel: 36, ctChannel: 37 };
    expect(realignMirror(mirror, [{ before, after }])).toEqual({
      universe: 0,
      briChannel: 259,
      rChannel: 260,
      gChannel: 261,
      bChannel: 262,
      ctChannel: 263
    });
  });

  it("emmene le master du bandeau avec ses zones", () => {
    const before = fixture("bandeau", 108, 151);
    const after = { ...before, address: 264 };
    const mirror = {
      zones: { universe: 0, startChannel: 108, zoneCount: 50, dimmerChannel: 258, fixtureId: "bandeau" }
    };
    // Avant ce correctif, le master restait a 258 : le bandeau lisait son
    // intensite a l'ancienne adresse.
    expect(realignMirror(mirror, [{ before, after }])?.zones).toEqual({
      universe: 0,
      startChannel: 264,
      zoneCount: 50,
      dimmerChannel: 414,
      fixtureId: "bandeau"
    });
  });

  it("renvoie null quand le miroir n'est pas concerne", () => {
    const before = fixture("par-bureau", 100, 8);
    const after = { ...before, address: 90 };
    expect(realignMirror({ universe: 0, rChannel: 34 }, [{ before, after }])).toBeNull();
  });
});
