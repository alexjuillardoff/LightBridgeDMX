import { describe, expect, it } from "vitest";
import type { Fixture, SmartLight } from "@lightbridgedmx/shared";
import type { DmxService } from "../dmx";
import { EffectRunner } from "./runner";

/** Univers bouchonne : on ne teste pas la sortie Art-Net, seulement ce que le
 *  runner ecrit et quand. */
const fakeDmx = () => {
  const universe = new Array<number>(512).fill(0);
  const writes: Array<{ address: number; values: number[]; source?: string }> = [];
  // Producteurs enregistres via onBeforeFrame. `frame()` joue une trame de sortie :
  // le runner n'a plus d'horloge a lui, c'est la boucle DMX qui le cadence.
  const producers = new Set<() => void>();
  const frame = () => producers.forEach((p) => p());
  const dmx = {
    onBeforeFrame: (p: () => void) => {
      producers.add(p);
      return () => producers.delete(p);
    },
    getUniverseSnapshot: () => [...universe],
    applyWrite: (w: { address: number; values: number[] }, source?: string) => {
      writes.push({ ...w, source });
      w.values.forEach((v, i) => (universe[w.address + i - 1] = v));
    },
    setChannel: (channel: number, value: number) => {
      universe[channel - 1] = value;
    }
  };
  return { dmx: dmx as unknown as DmxService, universe, writes, frame };
};

const logger = {
  child: () => logger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as never;

const par = {
  id: "par-1",
  name: "PAR",
  address: 10,
  universe: 0,
  channels: [
    { channel: 1, capability: "intensity" },
    { channel: 2, capability: "r" },
    { channel: 3, capability: "g" },
    { channel: 4, capability: "b" }
  ]
} as unknown as Fixture;

const dimmerEffect = (over = {}) => ({
  speed: 60,
  rate: 1,
  direction: "forward" as const,
  // Courbe neutre : ces tests verifient l'ecriture des canaux et le tramage, pas la
  // photometrie. Une loi carree y rendrait chaque valeur attendue illisible.
  curve: "linear" as const,
  dither: false as boolean,
  lines: [
    {
      attribute: "dimmer" as const,
      form: "pwm" as const,
      mode: "absolute" as const,
      low: 0,
      high: 100,
      phaseFrom: 0,
      phaseTo: 0,
      width: 100 // toujours haut : la valeur est previsible sans dependre de l'instant
    }
  ],
  ...over
});

/** PAR 56 Lampe : R/G/B **et** un master d'intensite. C'est la combinaison qui
 *  faisait qu'un effet de gradation bougeait le master en laissant le RGB noir. */
const parWithMaster = {
  id: "par-2",
  name: "PAR 56 Lampe",
  address: 25,
  universe: 0,
  channels: [
    { channel: 1, capability: "r" },
    { channel: 2, capability: "g" },
    { channel: 3, capability: "b" },
    { channel: 8, capability: "intensity" }
  ]
} as unknown as Fixture;

describe("EffectRunner", () => {
  it("ecrit le canal d'intensite du projecteur selectionne", async () => {
    const { dmx, universe, writes, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    await runner.run(dimmerEffect(), ["par-1"]);
    frame();

    // Adresse 10 + canal 1 - 1 = canal absolu 10, a fond (forme haute, high = 100 %).
    expect(universe[9]).toBe(255);
    expect(writes.some((w) => w.source?.startsWith("effect:"))).toBe(true);
    runner.stop();
  });

  it("rend les canaux a leur valeur d'avant a l'arret", async () => {
    const { dmx, universe, frame } = fakeDmx();
    universe[9] = 77; // le projecteur etait a 77 avant l'effet
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    const run = await runner.run(dimmerEffect(), ["par-1"]);
    frame();
    expect(universe[9]).toBe(255);

    runner.stopRun(run!.id);
    // Sans restauration, le projecteur resterait fige sur la derniere trame.
    expect(universe[9]).toBe(77);
    runner.stop();
  });

  it("le mode relatif se cale sur la valeur de depart, sans s'y additionner sans fin", async () => {
    const { dmx, universe, frame } = fakeDmx();
    universe[9] = 100;
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    // Forme constante a 1, bande 0..100 -> centre 0.5 -> decalage +127.5 : 100 + 128 = 228.
    await runner.run(dimmerEffect({ lines: [{ ...dimmerEffect().lines[0], mode: "relative" }] }), ["par-1"]);
    frame();
    const afterFirst = universe[9];
    expect(afterFirst).toBe(228);

    // Vingt trames plus tard, la valeur n'a pas derive : la reference est figee au
    // lancement, pas relue dans l'univers (sinon l'effet monterait jusqu'en butee).
    for (let i = 0; i < 20; i++) frame();
    expect(universe[9]).toBe(afterFirst);
    runner.stop();
  });

  it("un nouvel effet sur une selection qui recoupe remplace l'ancien", async () => {
    const { dmx } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    await runner.run(dimmerEffect(), ["par-1"]);
    await runner.run(dimmerEffect(), ["par-1"]);
    // Deux effets sur les memes canaux se disputeraient l'univers a 30 Hz.
    expect(runner.list()).toHaveLength(1);
    runner.stop();
  });

  it("refuse une selection sans cellule pilotable", async () => {
    const { dmx } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [], () => []);
    expect(await runner.run(dimmerEffect(), ["inconnu"])).toBeUndefined();
    runner.stop();
  });

  it("traduit une ligne dimmer en fondu de couleur sur les zones d'un bandeau", async () => {
    const stripFixture = {
      id: "s", name: "Bandeau", address: 108, universe: 0, channels: []
    } as unknown as Fixture;
    const strip = {
      id: "l",
      dmxMirror: { zones: { startChannel: 108, zoneCount: 2, fixtureId: "s" } }
    } as unknown as SmartLight;

    const { dmx, universe, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [stripFixture], () => [strip]);

    await runner.run(
      dimmerEffect({ color: { r: 200, g: 100, b: 50 }, bgColor: { r: 0, g: 0, b: 0 } }),
      ["s"]
    );
    frame();

    // Une zone n'a pas de canal d'intensite : l'effet doit sortir en couleur pleine.
    expect([universe[107], universe[108], universe[109]]).toEqual([200, 100, 50]);
    runner.stop();
  });
});

describe("tramage temporel", () => {
  it("alterne entre les deux entiers encadrants pour rendre une valeur fractionnaire", async () => {
    const { dmx, universe, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    // high = 50 % -> 127,5 exactement : la fraction vaut un demi-cran, le cas le
    // plus defavorable, et celui ou le tramage se voit le mieux.
    await runner.run(
      dimmerEffect({ dither: true, lines: [{ ...dimmerEffect().lines[0], low: 50, high: 50 }] }),
      ["par-1"]
    );

    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      frame();
      seen.push(universe[9]);
    }
    // Sans tramage, on lirait vingt fois la meme valeur arrondie.
    expect(new Set(seen).size).toBeGreaterThan(1);
    for (const v of seen) expect([127, 128]).toContain(v);
    // Et la moyenne doit retomber sur la valeur reelle demandee.
    const moyenne = seen.reduce((a, b) => a + b, 0) / seen.length;
    expect(moyenne).toBeGreaterThan(127.3);
    expect(moyenne).toBeLessThan(127.7);
    runner.stop();
  });

  it("reste inerte quand il est desactive — le defaut, chaine Art-Net oblige", async () => {
    const { dmx, universe, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    // Meme 127,5 que ci-dessus, mais sans tramage : la sortie doit etre figee.
    await runner.run(
      dimmerEffect({ lines: [{ ...dimmerEffect().lines[0], low: 50, high: 50 }] }),
      ["par-1"]
    );
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      frame();
      seen.push(universe[9]);
    }
    expect(new Set(seen).size).toBe(1);
    runner.stop();
  });

  it("ne derive pas sur une valeur entiere : pas de scintillement inutile", async () => {
    const { dmx, universe, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    // high = 100 % -> 255 pile : aucune fraction a repartir, la sortie doit etre stable.
    await runner.run(dimmerEffect(), ["par-1"]);
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      frame();
      seen.push(universe[9]);
    }
    expect(new Set(seen)).toEqual(new Set([255]));
    runner.stop();
  });
  it("retouche un effet en cours sans le relancer ni rendre les canaux", async () => {
    const { dmx, universe, frame } = fakeDmx();
    universe[9] = 40; // valeur d'avant l'effet, a restaurer plus tard
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    const run = await runner.run(dimmerEffect(), ["par-1"]);
    frame();
    expect(universe[9]).toBe(255);

    // Meme effet, plafonne a 50 % : la retouche prend effet des la trame suivante.
    const updated = runner.updateRun(
      run!.id,
      dimmerEffect({ lines: [{ ...dimmerEffect().lines[0], high: 50 }] })
    );
    frame();
    expect(universe[9]).toBe(128);
    // C'est bien le MEME effet : meme id, meme instant de depart. Le relancer aurait
    // remis la phase a zero, donc fait sauter le plateau a chaque cran d'encodeur.
    expect(updated?.id).toBe(run!.id);
    expect(updated?.startedAt).toBe(run!.startedAt);

    // La photo d'avant lancement survit a la retouche : l'arret rend toujours 40.
    runner.stopRun(run!.id);
    expect(universe[9]).toBe(40);
    runner.stop();
  });

  it("ignore la retouche d'un effet qui ne tourne plus", async () => {
    const { dmx } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [par], () => []);

    expect(runner.updateRun("effet-inconnu", dimmerEffect())).toBeUndefined();
    runner.stop();
  });
  it("pose la couleur de l'effet sur un projecteur qui a AUSSI un canal d'intensite", async () => {
    const { dmx, universe, frame } = fakeDmx();
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [parWithMaster], () => []);

    // Le RGB est noir au depart : c'est le cas reel qui rendait l'effet invisible.
    await runner.run(dimmerEffect({ color: { r: 255, g: 120, b: 0 } }), ["par-2"]);
    frame();

    expect(universe[31]).toBe(255); // adresse 25 + canal 8 - 1 = 32 : le master module
    expect([universe[24], universe[25], universe[26]]).toEqual([255, 120, 0]); // et la couleur sort
    runner.stop();
  });

  it("ne repeint pas la couleur quand l'effet n'en declare pas", async () => {
    const { dmx, universe, frame } = fakeDmx();
    // Teinte posee a la main dans le programmer, avant l'effet.
    universe[24] = 10;
    universe[25] = 200;
    universe[26] = 30;
    const runner = new EffectRunner(logger, dmx);
    runner.start(async () => [parWithMaster], () => []);

    await runner.run(dimmerEffect(), ["par-2"]);
    frame();

    // Un effet de gradation seul laisse la couleur tranquille, comme sur un pupitre.
    expect([universe[24], universe[25], universe[26]]).toEqual([10, 200, 30]);
    expect(universe[31]).toBe(255);
    runner.stop();
  });
});
