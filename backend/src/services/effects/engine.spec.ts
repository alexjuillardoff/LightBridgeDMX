import { describe, expect, it } from "vitest";
// Le moteur teste ici vit dans le package partage (packages/shared/src/effect-engine.ts) :
// la fenetre Effets s'en sert pour son apercu. Ses tests restent dans la suite du
// backend, qui est le seul paquet du depot equipe de Vitest.
import type { DmxEffect, EffectLine } from "@lightbridgedmx/shared";
import { evaluateDmxEffect, formValue, matricksPosition } from "@lightbridgedmx/shared";

/** Effet minimal : une ligne, la forme et la repartition demandees. */
const effect = (line: Partial<EffectLine>, rest: Partial<DmxEffect> = {}): DmxEffect => ({
  speed: 60,
  rate: 1,
  direction: "forward",
  // Courbe neutre : ces tests portent sur la forme d'onde, pas sur la photometrie.
  curve: "linear",
  dither: false,
  lines: [
    {
      attribute: "dimmer",
      form: "sin",
      mode: "absolute",
      low: 0,
      high: 100,
      phaseFrom: 0,
      phaseTo: 360,
      width: 50,
      ...line
    } as EffectLine
  ],
  ...rest
});

const line = (over: Partial<EffectLine> = {}): EffectLine =>
  effect(over).lines[0];

describe("formValue", () => {
  it("place les formes continues au bon endroit du cycle", () => {
    const l = line({ form: "sin" });
    expect(formValue(l, 0, 0)).toBeCloseTo(0.5, 6);
    expect(formValue(l, 0.25, 0)).toBeCloseTo(1, 6);
    expect(formValue(l, 0.75, 0)).toBeCloseTo(0, 6);

    expect(formValue(line({ form: "cos" }), 0, 0)).toBeCloseTo(1, 6);
    expect(formValue(line({ form: "rampUp" }), 0.3, 0)).toBeCloseTo(0.3, 6);
    expect(formValue(line({ form: "rampDown" }), 0.3, 0)).toBeCloseTo(0.7, 6);
    expect(formValue(line({ form: "triangle" }), 0.5, 0)).toBeCloseTo(1, 6);
  });

  it("respecte la largeur du creneau pwm", () => {
    const l = line({ form: "pwm", width: 25 });
    expect(formValue(l, 0.1, 0)).toBe(1); // dans les 25 % hauts
    expect(formValue(l, 0.4, 0)).toBe(0); // apres
  });

  it("adoucit les fronts avec attack et decay", () => {
    const l = line({ form: "pwm", width: 100, attack: 50, decay: 0 });
    // A mi-chemin de l'attaque (25 % du cycle pour une attaque de 50 %), on est a moitie monte.
    expect(formValue(l, 0.25, 0)).toBeCloseTo(0.5, 6);
    expect(formValue(l, 0.6, 0)).toBe(1); // attaque terminee
  });

  it("tire un niveau aleatoire stable pendant tout un cycle", () => {
    const l = line({ form: "random", width: 100, seed: 7 });
    // Deux instants du MEME cycle donnent la meme valeur : le moteur est sans etat,
    // sans cette propriete l'effet clignoterait a 30 Hz au lieu de tenir sa valeur.
    expect(formValue(l, 3.1, 5)).toBe(formValue(l, 3.9, 5));
    // Deux cellules differentes tirent differemment.
    expect(formValue(l, 3.1, 5)).not.toBe(formValue(l, 3.1, 6));
  });
});

describe("matricksPosition", () => {
  it("etale la phase sur la selection par defaut", () => {
    expect(matricksPosition(0, 4, undefined)).toBeCloseTo(0, 6);
    expect(matricksPosition(2, 4, undefined)).toBeCloseTo(0.5, 6);
  });

  it("blocks : des cellules voisines partagent la meme phase", () => {
    const m = { blocks: 2 };
    expect(matricksPosition(0, 4, m)).toBe(matricksPosition(1, 4, m));
    expect(matricksPosition(2, 4, m)).toBe(matricksPosition(3, 4, m));
    expect(matricksPosition(0, 4, m)).not.toBe(matricksPosition(2, 4, m));
  });

  it("groups : le motif se repete", () => {
    const m = { groups: 2 };
    // Avec 2 groupes sur 4 cellules, la 3e cellule rejoue la phase de la 1re.
    expect(matricksPosition(2, 4, m)).toBeCloseTo(matricksPosition(0, 4, m), 6);
  });

  it("wings : la seconde aile est le miroir de la premiere", () => {
    const m = { wings: 2 };
    // Sur 4 cellules pliees en 2 ailes, la derniere retrouve la phase de la premiere.
    expect(matricksPosition(3, 4, m)).toBeCloseTo(matricksPosition(0, 4, m), 6);
    expect(matricksPosition(2, 4, m)).toBeCloseTo(matricksPosition(1, 4, m), 6);
  });
});

describe("evaluateDmxEffect", () => {
  it("met la valeur a l'echelle low..high", () => {
    const [frame] = evaluateDmxEffect(effect({ form: "rampUp", low: 20, high: 60 }), 1, 0);
    // rampUp a t=0 vaut 0 -> on doit lire exactement la valeur basse.
    expect(frame.values[0]).toBeCloseTo(0.2, 6);
  });

  it("dephase les cellules les unes par rapport aux autres", () => {
    const [frame] = evaluateDmxEffect(effect({ form: "rampUp" }), 4, 0);
    const vals = frame.values;
    // Phase 0->360 sur 4 cellules : chacune est decalee d'un quart de cycle.
    expect(new Set(vals.map((v) => v.toFixed(4))).size).toBe(4);
  });

  it("met toute la selection a l'unisson quand phaseFrom == phaseTo", () => {
    const [frame] = evaluateDmxEffect(effect({ phaseFrom: 0, phaseTo: 0 }), 5, 1.3);
    for (const v of frame.values) expect(v).toBeCloseTo(frame.values[0], 9);
  });

  it("compose la vitesse BPM et le rate", () => {
    // 60 BPM x rate 2 = 2 cycles/s : a t=0,25 s on a parcouru un demi-cycle.
    const e = effect({ form: "rampUp", phaseFrom: 0, phaseTo: 0 }, { speed: 60, rate: 2 });
    const [frame] = evaluateDmxEffect(e, 1, 0.25);
    expect(frame.values[0]).toBeCloseTo(0.5, 6);
  });

  it("inverse le sens de defilement en backward", () => {
    const fwd = evaluateDmxEffect(
      effect({ form: "rampUp", phaseFrom: 0, phaseTo: 0 }, { speed: 60 }),
      1,
      0.25
    )[0].values[0];
    const bwd = evaluateDmxEffect(
      effect({ form: "rampUp", phaseFrom: 0, phaseTo: 0 }, { speed: 60, direction: "backward" }),
      1,
      0.25
    )[0].values[0];
    expect(bwd).toBeCloseTo(1 - fwd, 6);
  });

  it("interleave : une cellule sur N joue, les autres sont laissees intactes", () => {
    const e = effect({}, { matricks: { interleave: 2 } });
    const [frame] = evaluateDmxEffect(e, 4, 0);
    expect(frame.skipped).toEqual([false, true, false, true]);
  });

  it("evalue une ligne par attribut, chacune avec sa propre phase", () => {
    // Le cas du cercle de lyre : pan et tilt dephases de 90°.
    const circle: DmxEffect = {
      speed: 60,
      rate: 1,
      direction: "forward",
      curve: "linear",
      dither: false,
      lines: [
        { attribute: "pan", form: "sin", mode: "relative", low: 0, high: 100, phaseFrom: 0, phaseTo: 0, width: 50 },
        { attribute: "tilt", form: "sin", mode: "relative", low: 0, high: 100, phaseFrom: 90, phaseTo: 90, width: 50 }
      ]
    };
    const frames = evaluateDmxEffect(circle, 1, 0);
    expect(frames).toHaveLength(2);
    // La phase est un RETARD : a t=0 le pan est a mi-course (sin 0), et le tilt
    // retarde de 90° montre ce que le pan affichait un quart de cycle plus tot,
    // c'est-a-dire son minimum. Pan et tilt sont donc bien en quadrature — c'est
    // exactement ce qui dessine un cercle plutot qu'une diagonale.
    expect(frames[0].values[0]).toBeCloseTo(0.5, 6);
    expect(frames[1].values[0]).toBeCloseTo(0, 6);
  });

  it("suit les positions fournies au lieu du rang quand on lui en donne", () => {
    // Deux cellules dont la geometrie dit qu'elles sont au meme endroit doivent
    // jouer ensemble, meme si leurs rangs different.
    const [frame] = evaluateDmxEffect(effect({ form: "rampUp" }), 3, 0, [0.5, 0.5, 0]);
    expect(frame.values[0]).toBeCloseTo(frame.values[1], 9);
    expect(frame.values[0]).not.toBeCloseTo(frame.values[2], 6);
  });
});
