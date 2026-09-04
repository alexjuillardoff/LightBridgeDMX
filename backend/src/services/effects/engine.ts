// =============================================================================
// Moteur d'effets DMX : la math pure, sans effet de bord.
//
// Role : a partir de (effet, nombre de cellules, temps), renvoyer pour chaque
// ligne de l'effet une valeur 0..1 par cellule. Le runner traduit ensuite ces
// valeurs en ecritures DMX ; c'est lui qui connait les canaux, pas ce fichier.
//
// Le modele suit celui de grandMA2 (cf. le schema partage DmxEffectSchema) :
// une forme d'onde parcourue dans le temps, dephasee d'une cellule a l'autre,
// et redistribuee par les MAtricks. « Cellule » designe indifferemment un
// projecteur de la selection ou une zone d'un bandeau multi-cellules : le moteur
// ne fait pas la difference, ce qui est exactement le but.
// =============================================================================
import type { DmxEffect, EffectLine, EffectMatricks } from "@lightbridgedmx/shared";

/** Valeur calculee pour une cellule, sur une ligne donnee. */
export type LineFrame = {
  /** Valeur 0..1 apres mise a l'echelle low..high. */
  values: number[];
  /** Cellules ecartees par `interleave` : le runner ne doit rien leur ecrire, au
   *  lieu de leur ecrire la valeur basse. La nuance compte — en mode relatif,
   *  ecrire la valeur basse deplacerait la lyre au lieu de la laisser tranquille. */
  skipped: boolean[];
};

/**
 * Evalue toutes les lignes d'un effet pour `cellCount` cellules a l'instant donne.
 * Renvoie un LineFrame par ligne, dans l'ordre des lignes de l'effet.
 *
 * `positions` permet de substituer une distribution de phase calculee ailleurs
 * (typiquement la geometrie 3D d'un bandeau) au rang de la cellule. Quand il est
 * fourni, les MAtricks blocks/wings sont ignores : ils raisonnent en rang, et les
 * melanger a une distribution spatiale donne un resultat que personne ne sait lire.
 */
export function evaluateDmxEffect(
  effect: DmxEffect,
  cellCount: number,
  timeSeconds: number,
  positions?: number[]
): LineFrame[] {
  const n = Math.max(1, cellCount);
  const dir = effect.direction === "backward" ? -1 : 1;
  // Vitesse : BPM et Rate se composent, comme sur le pupitre ou Rate 1 = 60 BPM.
  const advance = (effect.speed / 60) * effect.rate * timeSeconds * dir;
  const interleave = Math.max(1, Math.floor(effect.matricks?.interleave ?? 1));

  return effect.lines.map((line) => {
    const values = new Array<number>(cellCount);
    const skipped = new Array<boolean>(cellCount);
    const span = line.phaseTo - line.phaseFrom;

    for (let i = 0; i < cellCount; i++) {
      // Interleave : une cellule sur N joue, les autres sont laissees intactes.
      if (interleave > 1 && i % interleave !== 0) {
        skipped[i] = true;
        values[i] = 0;
        continue;
      }
      skipped[i] = false;

      const u = positions ? clamp01(positions[i] ?? 0) : matricksPosition(i, n, effect.matricks);
      const phaseDeg = line.phaseFrom + span * u;
      // La phase est un RETARD, comme sur le pupitre : on la soustrait, ce qui fait
      // progresser l'effet de la premiere cellule vers la derniere.
      const pos = advance - phaseDeg / 360;
      const v = formValue(line, pos, i);
      // Mise a l'echelle low..high, en pourcents ramenes a 0..1.
      values[i] = (line.low + (line.high - line.low) * v) / 100;
    }
    return { values, skipped };
  });
}

/**
 * Valeur 0..1 de la forme d'onde a la position `pos`, exprimee en cycles :
 * partie entiere = numero de cycle, partie fractionnaire = avancement dedans.
 *
 * `cellRank` ne sert qu'aux formes aleatoires, pour que chaque cellule ait son
 * propre tirage tout en restant reproductible d'une trame a l'autre.
 */
export function formValue(line: EffectLine, pos: number, cellRank: number): number {
  const cycle = Math.floor(pos);
  const x = pos - cycle; // avancement dans le cycle, toujours dans [0,1[

  switch (line.form) {
    case "sin":
      return (Math.sin(2 * Math.PI * x) + 1) / 2;
    case "cos":
      return (Math.cos(2 * Math.PI * x) + 1) / 2;
    case "rampUp":
      return x;
    case "rampDown":
      return 1 - x;
    case "triangle":
      return 1 - Math.abs(2 * x - 1);
    case "pwm": {
      // Creneau : haut pendant `width` % du cycle. Attack/Decay adoucissent les fronts.
      const duty = Math.max(0.01, line.width / 100);
      return x < duty ? envelope(x / duty, line) : 0;
    }
    case "random": {
      // Un niveau tire par cellule ET par cycle : il tient tout le cycle, puis change.
      // Le tirage depend du numero de cycle, donc il est identique sur deux trames du
      // meme cycle — indispensable, le moteur etant sans etat.
      const level = hash01(cellRank, cycle, line.seed ?? 1);
      const duty = Math.max(0.01, line.width / 100);
      return x < duty ? level * envelope(x / duty, line) : 0;
    }
  }
}

/** Enveloppe Attack/Decay appliquee a la portion haute d'une forme a fronts durs.
 *  `u` est l'avancement 0..1 DANS cette portion ; attack/decay valent 0..100 % de
 *  cette portion : 0 = front franc, 100 = fondu sur toute la duree. */
function envelope(u: number, line: EffectLine): number {
  const attack = (line.attack ?? 0) / 100;
  const decay = (line.decay ?? 0) / 100;
  let e = 1;
  if (attack > 0) e = Math.min(e, u / attack);
  if (decay > 0) e = Math.min(e, (1 - u) / decay);
  return Math.max(0, Math.min(1, e));
}

/**
 * Position 0..1 d'une cellule dans la distribution de phase, apres MAtricks.
 *
 * L'ordre d'application n'est pas arbitraire : wings plie la selection, blocks
 * agglomere les voisines DANS l'aile, puis groups repete le motif obtenu. Plier
 * apres avoir groupe donnerait des ailes de tailles inegales.
 */
export function matricksPosition(rank: number, n: number, m: EffectMatricks | undefined): number {
  const wings = Math.max(1, Math.floor(m?.wings ?? 1));
  const blocks = Math.max(1, Math.floor(m?.blocks ?? 1));
  const groups = Math.max(1, Math.floor(m?.groups ?? 1));

  // Wings : on plie la selection en N ailes, une sur deux etant lue a l'envers.
  const wingLen = Math.max(1, Math.ceil(n / wings));
  const wingIndex = Math.floor(rank / wingLen);
  let k = rank % wingLen;
  if (wingIndex % 2 === 1) k = wingLen - 1 - k;

  // Blocks : N cellules consecutives partagent la meme phase.
  const blockIndex = Math.floor(k / blocks);
  const blockCount = Math.max(1, Math.ceil(wingLen / blocks));

  // Groups : le motif complet se repete N fois sur la longueur de l'aile.
  const u = (blockIndex * groups) / blockCount;
  return u - Math.floor(u);
}

/** Generateur pseudo-aleatoire deterministe : memes entrees -> meme sortie 0..1.
 *  Le moteur etant appele a 30 Hz sans etat, un Math.random() ferait clignoter
 *  n'importe quoi a chaque trame ; ici le tirage ne change qu'au cycle suivant. */
export function hash01(a: number, b: number, seed: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
