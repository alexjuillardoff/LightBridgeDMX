import { describe, expect, it } from "vitest";
import type { SmartLightState } from "@lightbridgedmx/shared";

import { computeStateDiff } from "./index";

/** Etat de reference : violet 260/94, mais joue en blanc 3040 K. C'est la
 *  configuration piegeuse — teinte et temperature coexistent dans l'etat, seul
 *  `colorMode` dit laquelle sort reellement. */
const base = (over: Partial<SmartLightState> = {}): SmartLightState => ({
  on: true,
  hue: 260,
  sat: 94,
  brightness: 100,
  colorMode: "ct",
  ct: 3040,
  reachable: true,
  ...over
});

describe("computeStateDiff", () => {
  it("n'envoie rien quand rien n'a bouge", () => {
    expect(computeStateDiff(base(), base())).toBeNull();
  });

  it("renvoie teinte et saturation au passage blanc -> couleur, meme a nombres identiques", () => {
    // Le cas qui cassait les scenes HomeKit : seul le mode change, les valeurs de
    // teinte/saturation trainaient deja dans l'etat. Sans forcage, diff vide et
    // l'ampoule restait blanche.
    const diff = computeStateDiff(base(), base({ colorMode: "hs" }));
    expect(diff).toEqual({ hue: 260, sat: 94 });
  });

  it("renvoie la temperature au passage couleur -> blanc, meme a nombres identiques", () => {
    const diff = computeStateDiff(base({ colorMode: "hs" }), base());
    expect(diff).toEqual({ ct: 3040 });
  });

  it("renvoie la couleur complete a l'allumage", () => {
    // Lampe eteinte, aucune couleur n'est transmise : ce qu'on croit pousse ne
    // l'a jamais ete, il faut tout redire au moment ou elle s'allume.
    const diff = computeStateDiff(base({ on: false }), base());
    expect(diff).toEqual({ on: true, ct: 3040, brightness: 100 });
  });

  it("n'envoie que l'extinction quand la lampe s'eteint", () => {
    expect(computeStateDiff(base(), base({ on: false }))).toEqual({ on: false });
  });

  it("sans etat precedent, envoie tout", () => {
    expect(computeStateDiff(null, base({ colorMode: "hs" }))).toEqual({
      on: true,
      hue: 260,
      sat: 94,
      brightness: 100
    });
  });

  it("respecte la tolerance sur les micro-variations", () => {
    expect(computeStateDiff(base({ colorMode: "hs" }), base({ colorMode: "hs", sat: 94.5 }))).toBeNull();
    expect(computeStateDiff(base({ colorMode: "hs" }), base({ colorMode: "hs", sat: 94.5 }), 0.3)).toEqual({
      sat: 94.5
    });
  });
});
