// Tests du moteur d'effets (EffectEngine), et notamment de l'effet parametrique
// "ma" (facon grandMA2). Le moteur etant une fonction pure, on peut verifier
// chaque forme d'onde en interrogeant le temps qui nous arrange.
import { describe, expect, it } from "vitest";
import {
  buildLinearLayout,
  SMART_LIGHT_EFFECT_PRESETS,
  SmartLightEffectConfigSchema,
  type EffectMa,
  type SmartLightZoneLayout
} from "@lightbridgedmx/shared";
import { evaluateEffect } from "./effect-engine";

const layout = (zones: number) => buildLinearLayout(zones);

// Effet "ma" minimal : dimmer blanc sur fond noir, toutes les zones a l'unisson.
// Chaque test part de cette base et ne change que ce qui l'interesse.
const base: EffectMa = {
  kind: "ma",
  form: "sin",
  target: "dimmer",
  speed: 60,          // 60 BPM = 1 cycle par seconde : t en secondes = t en cycles
  low: 0,
  high: 100,
  phaseFrom: 0,
  phaseTo: 0,
  width: 50,
  color: { r: 255, g: 255, b: 255 },
  bgColor: { r: 0, g: 0, b: 0 }
};

describe("effet ma — formes d'onde", () => {
  it("sin part du milieu, monte au quart de cycle et redescend a mi-cycle", () => {
    const at = (t: number) => evaluateEffect(base, layout(1), t)[0].r;
    expect(at(0)).toBe(128);        // (sin 0 + 1) / 2 = 0,5
    expect(at(0.25)).toBe(255);     // sommet
    expect(at(0.5)).toBe(128);
    expect(at(0.75)).toBe(0);       // creux
  });

  it("cos est le sinus decale d'un quart de cycle (part du haut)", () => {
    const cos = { ...base, form: "cos" as const };
    expect(evaluateEffect(cos, layout(1), 0)[0].r).toBe(255);
    expect(evaluateEffect(cos, layout(1), 0.5)[0].r).toBe(0);
  });

  it("rampUp monte lineairement puis retombe au cycle suivant", () => {
    const ramp = { ...base, form: "rampUp" as const };
    expect(evaluateEffect(ramp, layout(1), 0)[0].r).toBe(0);
    expect(evaluateEffect(ramp, layout(1), 0.5)[0].r).toBe(128);
    expect(evaluateEffect(ramp, layout(1), 0.999)[0].r).toBe(255);
    expect(evaluateEffect(ramp, layout(1), 1)[0].r).toBe(0);
  });

  it("triangle culmine a mi-cycle et vaut zero aux extremites", () => {
    const tri = { ...base, form: "triangle" as const };
    expect(evaluateEffect(tri, layout(1), 0)[0].r).toBe(0);
    expect(evaluateEffect(tri, layout(1), 0.5)[0].r).toBe(255);
  });

  it("pwm reste haut pendant width % du cycle, puis bas", () => {
    const pwm = { ...base, form: "pwm" as const, width: 25 };
    expect(evaluateEffect(pwm, layout(1), 0.1)[0].r).toBe(255);
    expect(evaluateEffect(pwm, layout(1), 0.24)[0].r).toBe(255);
    expect(evaluateEffect(pwm, layout(1), 0.26)[0].r).toBe(0);
    expect(evaluateEffect(pwm, layout(1), 0.99)[0].r).toBe(0);
  });

  it("attack et decay adoucissent les fronts du creneau", () => {
    const soft = { ...base, form: "pwm" as const, width: 100, attack: 50, decay: 50 };
    const at = (t: number) => evaluateEffect(soft, layout(1), t)[0].r;
    expect(at(0)).toBe(0);       // debut de la montee
    expect(at(0.5)).toBe(255);   // sommet, entre attack et decay
    expect(at(0.25)).toBe(128);  // mi-montee
    expect(at(0.75)).toBe(128);  // mi-descente
  });

  it("random tient son niveau pendant tout un cycle et le retire au suivant", () => {
    const rnd = { ...base, form: "random" as const, width: 100, seed: 42 };
    const a = evaluateEffect(rnd, layout(1), 0.2)[0].r;
    const b = evaluateEffect(rnd, layout(1), 0.8)[0].r;
    expect(a).toBe(b); // meme cycle -> meme niveau
    // Sur 30 cycles, le niveau doit varier : sinon le tirage est constant.
    const levels = new Set<number>();
    for (let c = 0; c < 30; c++) levels.add(evaluateEffect(rnd, layout(1), c + 0.5)[0].r);
    expect(levels.size).toBeGreaterThan(5);
  });

  it("random est reproductible : meme graine et meme instant -> meme trame", () => {
    const rnd = { ...base, form: "random" as const, width: 100, seed: 7 };
    expect(evaluateEffect(rnd, layout(20), 3.3)).toEqual(evaluateEffect(rnd, layout(20), 3.3));
  });
});

describe("effet ma — phase, direction et plage low/high", () => {
  it("phase 0 -> 0 fait jouer toutes les zones a l'unisson", () => {
    const frame = evaluateEffect(base, layout(10), 0.37);
    expect(new Set(frame.map((c) => c.r)).size).toBe(1);
  });

  it("phase 0 -> 360 etale un cycle complet sur le bandeau", () => {
    const spread = { ...base, form: "rampUp" as const, phaseTo: 360, speed: 0 };
    const frame = evaluateEffect(spread, layout(4), 0);
    // La phase est un retard : zone 0 est en tete, les suivantes reculent dans le cycle.
    expect(frame.map((c) => c.r)).toEqual([0, 191, 128, 64]);
  });

  it("la direction backward inverse le sens de defilement", () => {
    const fwd = { ...base, form: "rampUp" as const, phaseTo: 360 };
    const bwd = { ...fwd, direction: "backward" as const };
    const t = 0.3;
    // Un aller a t vaut le retour a -t : les deux trames sont donc identiques.
    expect(evaluateEffect(bwd, layout(8), t)).toEqual(evaluateEffect(fwd, layout(8), -t));
  });

  it("low et high bornent la sortie", () => {
    const clamped = { ...base, low: 20, high: 60 };
    const values = [];
    for (let t = 0; t < 1; t += 0.05) values.push(evaluateEffect(clamped, layout(1), t)[0].r);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(Math.round(0.2 * 255) - 1);
    expect(Math.max(...values)).toBeLessThanOrEqual(Math.round(0.6 * 255) + 1);
  });

  it("une vitesse nulle fige l'effet", () => {
    const frozen = { ...base, speed: 0 };
    expect(evaluateEffect(frozen, layout(5), 0)).toEqual(evaluateEffect(frozen, layout(5), 12.5));
  });
});

describe("effet ma — MAtricks", () => {
  it("blocks rend solidaires les zones consecutives", () => {
    const cfg = { ...base, form: "rampUp" as const, phaseTo: 360, speed: 0, matricks: { blocks: 2 } };
    const frame = evaluateEffect(cfg, layout(8), 0);
    for (let i = 0; i < 8; i += 2) expect(frame[i]).toEqual(frame[i + 1]);
    expect(frame[0]).not.toEqual(frame[2]);
  });

  it("groups repete le motif sur la longueur", () => {
    const cfg = { ...base, form: "rampUp" as const, phaseTo: 360, speed: 0, matricks: { groups: 2 } };
    const frame = evaluateEffect(cfg, layout(8), 0);
    for (let i = 0; i < 4; i++) expect(frame[i]).toEqual(frame[i + 4]);
  });

  it("wings 2 rend le bandeau symetrique par rapport a son centre", () => {
    const cfg = { ...base, form: "rampUp" as const, phaseTo: 360, speed: 0, matricks: { wings: 2 } };
    const frame = evaluateEffect(cfg, layout(8), 0);
    for (let i = 0; i < 4; i++) expect(frame[i]).toEqual(frame[7 - i]);
  });

  it("les zones spare restent noires et ne consomment pas de phase", () => {
    const cfg = { ...base, form: "rampUp" as const, phaseTo: 360, speed: 0 };
    const withSpare = { ...layout(5), spareZones: [2] };
    const frame = evaluateEffect(cfg, withSpare, 0);
    expect(frame[2]).toEqual({ r: 0, g: 0, b: 0 });
    // Les 4 zones actives se partagent le cycle comme si la spare n'existait pas.
    expect(frame.filter((_, i) => i !== 2).map((c) => c.r)).toEqual([0, 191, 128, 64]);
  });
});

describe("effet ma — cibles", () => {
  it("target color fait un fondu entre les deux couleurs", () => {
    const cfg: EffectMa = {
      ...base, target: "color", form: "rampUp", speed: 60,
      color: { r: 0, g: 0, b: 0 }, colorTo: { r: 200, g: 100, b: 50 }
    };
    expect(evaluateEffect(cfg, layout(1), 0)[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(evaluateEffect(cfg, layout(1), 0.5)[0]).toEqual({ r: 100, g: 50, b: 25 });
  });

  it("target hue balaie la roue chromatique", () => {
    const cfg: EffectMa = { ...base, target: "hue", form: "rampUp", hueFrom: 0, hueTo: 360, saturation: 100 };
    expect(evaluateEffect(cfg, layout(1), 0)[0]).toEqual({ r: 255, g: 0, b: 0 });        // 0° rouge
    expect(evaluateEffect(cfg, layout(1), 1 / 3)[0]).toEqual({ r: 0, g: 255, b: 0 });    // 120° vert
    expect(evaluateEffect(cfg, layout(1), 2 / 3)[0]).toEqual({ r: 0, g: 0, b: 255 });    // 240° bleu
  });

  it("brightness attenue la trame entiere", () => {
    const dim = { ...base, brightness: 50 };
    expect(evaluateEffect(dim, layout(1), 0.25)[0].r).toBe(128);
  });
});

describe("effet ma — distribution spatiale (layout 3D)", () => {
  // Layout volontairement "mal cable" : l'ordre des zones sur le ruban n'a rien a
  // voir avec leur hauteur. C'est exactement le cas du bandeau en boucle, ou la
  // zone 6 (montee de coin) est physiquement au plafond et la zone 30 au sol.
  //   zone 0 : sol, a gauche      zone 1 : plafond, a droite
  //   zone 2 : plafond, a gauche  zone 3 : sol, a droite
  const seg = (x: number, y: number) => ({ start: { x, y, z: 0 }, end: { x, y, z: 0 } });
  const mixed: SmartLightZoneLayout = {
    mode: "unlinked",
    segments: [seg(-1, 0), seg(1, 2), seg(-1, 2), seg(1, 0)]
  };

  it("l'axe vertical regroupe les zones par hauteur, pas par rang sur le ruban", () => {
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 180,
      spatial: { mode: "axis", direction: { x: 0, y: 1, z: 0 } }
    };
    const frame = evaluateEffect(cfg, mixed, 0);
    expect(frame[0]).toEqual(frame[3]); // les deux zones du sol jouent ensemble
    expect(frame[1]).toEqual(frame[2]); // les deux zones du plafond aussi
    expect(frame[0]).not.toEqual(frame[1]);
  });

  it("sans distribution spatiale, les memes zones suivent l'ordre du ruban", () => {
    const cfg: EffectMa = { ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 180 };
    const frame = evaluateEffect(cfg, mixed, 0);
    expect(frame[0]).not.toEqual(frame[3]);
  });

  it("l'axe horizontal regroupe les zones par position gauche/droite", () => {
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 180,
      spatial: { mode: "axis", direction: { x: 1, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, mixed, 0);
    expect(frame[0]).toEqual(frame[2]); // les deux zones de gauche
    expect(frame[1]).toEqual(frame[3]); // les deux zones de droite
  });

  it("le mode radial classe les zones par distance a l'origine", () => {
    const radial: SmartLightZoneLayout = {
      mode: "unlinked",
      segments: [seg(1, 0), seg(2, 0), seg(3, 0)] // a 1, 2 et 3 m de l'origine
    };
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 180,
      spatial: { mode: "radial", origin: { x: 0, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, radial, 0);
    // La phase est un retard : la zone la plus proche est en tete de cycle, les
    // suivantes reculent dedans (0° -> 90° -> 180° de retard).
    expect(frame.map((c) => c.r)).toEqual([0, 191, 128]);
  });

  it("les zones spare ne faussent pas l'etendue mesuree", () => {
    // La zone spare est rangee tres loin (comme le fait buildUShapeLayout) : si elle
    // comptait dans le min/max, elle ecraserait toute la dynamique des trois autres.
    const withSpare: SmartLightZoneLayout = {
      mode: "unlinked",
      segments: [seg(1, 0), seg(2, 0), seg(3, 0), seg(50, 0)],
      spareZones: [3]
    };
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 180,
      spatial: { mode: "radial", origin: { x: 0, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, withSpare, 0);
    expect(frame.slice(0, 3).map((c) => c.r)).toEqual([0, 191, 128]);
    expect(frame[3]).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("effet ma — distribution angulaire (tour de piece)", () => {
  // Quatre zones aux quatre points cardinaux autour de l'origine, plus une
  // cinquieme au plafond exactement au-dessus de la premiere : c'est le cas du
  // bandeau en boucle, ou la traversee de plafond surplombe la plinthe du fond.
  const at = (x: number, y: number, z: number) => ({ start: { x, y, z }, end: { x, y, z } });
  const ring: SmartLightZoneLayout = {
    mode: "unlinked",
    segments: [at(0, 0, -1), at(1, 0, 0), at(0, 0, 1), at(-1, 0, 0), at(0, 2.5, -1)]
  };

  it("deux zones dans la meme direction jouent ensemble, quelle que soit leur hauteur", () => {
    const cfg: EffectMa = {
      ...base, form: "sin", speed: 0.5, phaseFrom: 0, phaseTo: 360,
      spatial: { mode: "angular", origin: { x: 0, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, ring, 1.7);
    expect(frame[4]).toEqual(frame[0]); // le plafond du fond suit la plinthe du fond
  });

  it("les quatre points cardinaux sont a 90° les uns des autres", () => {
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 360,
      spatial: { mode: "angular", origin: { x: 0, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, ring, 0);
    // Un quart de tour = un quart de cycle de retard, dans l'ordre du tour d'horloge.
    const quarters = frame.slice(0, 4).map((c) => Math.round((c.r / 255) * 4) / 4);
    expect(new Set(quarters).size).toBe(4);
  });

  it("un demi-tour ne couvre qu'une demi-phase (pas de mise a l'echelle sur l'etendue)", () => {
    // Trois zones sur un demi-cercle seulement : contrairement aux modes axis et
    // radial, l'azimut n'est pas etire pour occuper toute la plage de phase.
    const half: SmartLightZoneLayout = {
      mode: "unlinked",
      segments: [at(0, 0, -1), at(1, 0, 0), at(0, 0, 1)]
    };
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 360,
      spatial: { mode: "angular", origin: { x: 0, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, half, 0);
    // La zone 0 est a 180° de la zone 2 : un demi-cycle de retard, et pas un tour
    // complet — l'azimut n'est pas etire pour occuper toute la plage de phase.
    expect(frame[2].r).toBe(0);
    expect(frame[0].r).toBe(128);
  });
});

describe("effet ma — restriction a des sections du layout", () => {
  const at = (x: number) => ({ start: { x, y: 0, z: 0 }, end: { x, y: 0, z: 0 } });
  const twoSides: SmartLightZoneLayout = {
    mode: "unlinked",
    segments: [at(0), at(1), at(2), at(10), at(11), at(12)],
    sides: [
      { label: "plafond", zoneStart: 0, zoneEnd: 2 },
      { label: "sol", zoneStart: 3, zoneEnd: 5 }
    ]
  };

  it("les zones hors des sections visees prennent la valeur basse", () => {
    const cfg: EffectMa = { ...base, form: "sin", low: 0, high: 100, sides: ["sol"] };
    const frame = evaluateEffect(cfg, twoSides, 0.25);
    expect(frame.slice(0, 3)).toEqual([
      { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }
    ]);
    expect(frame[3].r).toBe(255); // sommet du sinus sur la section visee
  });

  it("la phase se repartit sur les seules zones retenues", () => {
    const cfg: EffectMa = {
      ...base, form: "rampUp", speed: 0, phaseFrom: 0, phaseTo: 360, sides: ["sol"]
    };
    const frame = evaluateEffect(cfg, twoSides, 0);
    // Trois zones retenues : elles se partagent le cycle entier a elles seules.
    expect(frame.slice(3).map((c) => c.r)).toEqual([0, 170, 85]);
  });

  it("l'etendue spatiale est mesuree sur les seules zones retenues", () => {
    // Triangle sur 180° = degrade spatial exact (v = position), sans repli.
    const cfg: EffectMa = {
      ...base, form: "triangle", speed: 0, phaseFrom: 0, phaseTo: 180, sides: ["sol"],
      spatial: { mode: "axis", direction: { x: 1, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, twoSides, 0);
    // Les X retenus vont de 10 a 12 : la section couvre bien 0 -> 100 %, et non
    // la portion 10/12 qu'elle occuperait si les zones exclues comptaient encore.
    expect(frame.slice(3).map((c) => c.r)).toEqual([0, 128, 255]);
  });

  it("un degrade fixe (triangle sur 180°) ne se replie pas aux extremites", () => {
    // Le piege du moteur : sur 360°, la zone la plus lointaine retombe sur la
    // valeur de la plus proche. Sur ce bandeau, tout le plafond passerait en phase
    // avec tout le sol. Le triangle sur 180° donne exactement v = position.
    const cfg: EffectMa = {
      ...base, form: "triangle", speed: 0, phaseFrom: 0, phaseTo: 180,
      spatial: { mode: "axis", direction: { x: 1, y: 0, z: 0 } }
    };
    const frame = evaluateEffect(cfg, twoSides, 0);
    const values = frame.map((c) => c.r);
    expect(values[0]).toBe(0);
    expect(values[5]).toBe(255);
    // Strictement croissant : aucun retour en arriere.
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  it("une section inconnue ne filtre rien (plutot qu'un bandeau eteint)", () => {
    const cfg: EffectMa = { ...base, form: "sin", sides: ["mezzanine"] };
    const frame = evaluateEffect(cfg, twoSides, 0.25);
    expect(frame.every((c) => c.r === 255)).toBe(true);
  });
});

describe("pool d'effets predefinis", () => {
  it("chaque preset est un effet valide et produit une trame de la bonne taille", () => {
    for (const preset of SMART_LIGHT_EFFECT_PRESETS) {
      expect(() => SmartLightEffectConfigSchema.parse(preset.config)).not.toThrow();
      const frame = evaluateEffect(preset.config, layout(50), 1.234);
      expect(frame).toHaveLength(50);
      for (const c of frame) {
        for (const v of [c.r, c.g, c.b]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("les identifiants du pool sont uniques", () => {
    const ids = SMART_LIGHT_EFFECT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
