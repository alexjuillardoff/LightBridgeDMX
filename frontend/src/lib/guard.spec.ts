import { describe, expect, it } from "vitest";
import { countLocked, isLocked, lockReason, unlocked } from "./guard";

describe("guard — garde de la chambre", () => {
  it("verrouille par pièce, insensible à la casse", () => {
    expect(lockReason({ id: "a", name: "PAR", room: "Chambre" })).toContain("Pièce protégée");
    expect(lockReason({ id: "a", name: "PAR", room: "BEDROOM" })).toContain("Pièce protégée");
    expect(lockReason({ id: "a", name: "PAR", room: "salon" })).toBeNull();
  });

  it("verrouille par nom, mot entier seulement", () => {
    expect(lockReason({ id: "a", name: "Plafonnier chambre" })).toBe("Projecteur de chambre");
    expect(lockReason({ id: "a", name: "Bedroom spot" })).toBe("Projecteur de chambre");
    expect(lockReason({ id: "a", name: "Antichambre" })).toBeNull();
  });

  it("unlocked et countLocked filtrent", () => {
    const list = [
      { id: "1", name: "PAR salon", room: "salon" },
      { id: "2", name: "PAR chambre", room: "chambre" },
      { id: "3", name: "Lampe", room: "bureau" }
    ];
    expect(unlocked(list).map((f) => f.id)).toEqual(["1", "3"]);
    expect(countLocked(list)).toBe(1);
    expect(isLocked(list[1])).toBe(true);
  });
});
