// Tests du constructeur de layout par chemin. C'est lui qui traduit un releve fait
// a la main — « le ruban part de la droite, longe les niches, descend a gauche,
// puis fait le tour du bas » — en coordonnees 3D exploitables par le moteur d'effets.
import { describe, expect, it } from "vitest";
import { buildPathLayout } from "@lightbridgedmx/shared";

const P = (x: number, y: number, z: number) => ({ x, y, z });

describe("buildPathLayout", () => {
  it("repartit les zones d'un troncon regulierement entre ses extremites", () => {
    const layout = buildPathLayout({ legs: [{ zones: 4, from: P(0, 0, 0), to: P(4, 0, 0) }] });
    expect(layout.segments).toHaveLength(4);
    expect(layout.segments[0]).toEqual({ start: P(0, 0, 0), end: P(1, 0, 0) });
    expect(layout.segments[3]).toEqual({ start: P(3, 0, 0), end: P(4, 0, 0) });
  });

  it("enchaine les troncons dans l'ordre du ruban", () => {
    const layout = buildPathLayout({
      legs: [
        { zones: 2, from: P(0, 0, 0), to: P(2, 0, 0) },
        { zones: 2, from: P(2, 0, 0), to: P(2, 2, 0) }
      ]
    });
    expect(layout.segments).toHaveLength(4);
    // La 3e zone demarre ou la 2e s'arrete : le chemin ne saute pas.
    expect(layout.segments[2].start).toEqual(layout.segments[1].end);
    expect(layout.segments[3].end).toEqual(P(2, 2, 0));
  });

  it("un troncon nomme devient une section visable par les effets", () => {
    const layout = buildPathLayout({
      legs: [
        { label: "haut", zones: 3, from: P(0, 1, 0), to: P(3, 1, 0), color: "#ff0000" },
        { zones: 1, from: P(3, 1, 0), to: P(3, 0, 0) },
        { label: "bas", zones: 2, from: P(3, 0, 0), to: P(1, 0, 0) }
      ]
    });
    expect(layout.sides).toEqual([
      { label: "haut", zoneStart: 0, zoneEnd: 2, color: "#ff0000" },
      { label: "bas", zoneStart: 4, zoneEnd: 5 }
    ]);
  });

  it("les zones spare gardent leur place et sont reportees dans le layout", () => {
    const layout = buildPathLayout({
      legs: [{ zones: 5, from: P(0, 0, 0), to: P(5, 0, 0) }],
      spareZones: [1, 3]
    });
    expect(layout.segments).toHaveLength(5);
    expect(layout.spareZones).toEqual([1, 3]);
    // La zone 4 reste a sa place : une zone cachee ne decale pas le reste du ruban.
    expect(layout.segments[4].start).toEqual(P(4, 0, 0));
  });

  it("ignore les troncons vides plutot que de produire des sections fantomes", () => {
    const layout = buildPathLayout({
      legs: [{ label: "rien", zones: 0, from: P(0, 0, 0), to: P(1, 0, 0) },
             { label: "quelque chose", zones: 2, from: P(0, 0, 0), to: P(2, 0, 0) }]
    });
    expect(layout.segments).toHaveLength(2);
    expect(layout.sides).toEqual([{ label: "quelque chose", zoneStart: 0, zoneEnd: 1 }]);
  });
});
