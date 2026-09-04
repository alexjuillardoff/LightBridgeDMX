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
//
// Ce module vit dans le package PARTAGE : la fenetre Effets s'en sert pour animer
// son apercu, le runner pour ecrire dans l'univers. Une seule math pour les deux,
// donc un apercu qui ne peut pas mentir sur ce que le plateau va faire.
// =============================================================================
import type {
  DmxEffect,
  EffectAttribute,
  EffectLine,
  EffectMatricks,
  EffectSpatial,
  Point3D,
  RgbColor
} from "./index";
import type { EffectCell } from "./effect-cells";

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

// ─── Distribution spatiale ──────────────────────────────────────────────────

/**
 * Distribution de phase par la geometrie, quand les cellules ont une position 3D.
 *
 * Renvoie null des qu'aucune position n'est connue — cas de toute selection de
 * projecteurs classiques, qui n'ont pas de coordonnees dans le patch : la phase
 * retombe alors sur le rang de la cellule, et les MAtricks reprennent la main.
 */
export function spatialPositions(
  cells: EffectCell[],
  spatial: EffectSpatial | undefined,
  sides: string[] | undefined,
  groups: number
): number[] | null {
  if (!spatial) return null;
  if (!cells.some((c) => c.position)) return null;

  const reps = Math.max(1, Math.floor(groups));
  const origin = spatial.origin ?? { x: 0, y: 0, z: 0 };
  const axis = normalize(spatial.direction ?? { x: 1, y: 0, z: 0 });
  // Sections retenues : une etiquette inconnue ne doit pas eteindre tout le monde,
  // donc on ne filtre que si au moins une cellule correspond.
  const wanted = sides && sides.length > 0 ? new Set(sides) : null;
  const included = cells.map((c) => !wanted || (c.side !== undefined && wanted.has(c.side)));
  if (wanted && !included.some(Boolean)) included.fill(true);

  const out = new Array<number>(cells.length).fill(0);

  // Mode angulaire : l'azimut est deja borne (un tour = 360°), donc pas de mise a
  // l'echelle sur l'etendue mesuree — sinon un bandeau qui ne fait qu'un demi-tour
  // verrait sa phase etiree sur un tour entier, et le balayage sauterait en
  // refermant la boucle.
  if (spatial.mode === "angular") {
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i].position;
      if (!included[i] || !p) continue;
      const angle = Math.atan2(p.x - origin.x, p.z - origin.z) / (2 * Math.PI);
      const u = (angle - Math.floor(angle)) * reps;
      out[i] = u - Math.floor(u);
    }
    return out;
  }

  const scalars = new Array<number>(cells.length).fill(0);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i].position;
    if (!included[i] || !p) continue;
    const value =
      spatial.mode === "radial"
        ? Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z)
        : p.x * axis.x + p.y * axis.y + p.z * axis.z;
    scalars[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Garde-fou : geometrie degeneree (toutes les cellules au meme endroit).
  const span = Math.max(max - min, 1e-6);
  for (let i = 0; i < cells.length; i++) {
    if (!included[i] || !cells[i].position) continue;
    const u = ((scalars[i] - min) / span) * reps;
    // Sans repetition on garde la valeur telle quelle : la cellule la plus eloignee
    // doit atteindre 1 (donc phaseTo), pas repartir a 0. Avec repetition, le modulo
    // est justement ce qui recree le motif a chaque tour.
    out[i] = reps === 1 ? u : u - Math.floor(u);
  }
  return out;
}

function normalize(v: Point3D): Point3D {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 1, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ─── Traduction en lumiere ──────────────────────────────────────────────────

/** Courbe de gradation : convertit une intensite VOULUE (0..1, perceptuelle) en
 *  valeur DMX relative (0..1, photometrique). Voir DmxEffectSchema.curve. */
export function applyCurve(v: number, curve: DmxEffect["curve"]): number {
  const k = v < 0 ? 0 : v > 1 ? 1 : v;
  switch (curve) {
    case "square":
      return k * k;
    case "cube":
      return k * k * k;
    case "linear":
      return k;
  }
}

/**
 * Couleur prise par une cellule RGB SANS canal d'intensite propre — chaque zone
 * d'un bandeau — pour la valeur `v` (0..1) d'une ligne d'effet.
 *
 * Renvoie null quand l'attribut n'a rien a dire au trio R/G/B (pan, tilt, ou une
 * composante isolee) : la cellule ne sait alors pas jouer cette ligne.
 *
 * Partage entre le runner (qui l'ecrit sur le plateau) et l'apercu de la fenetre
 * Effets (qui la peint a l'ecran) : les deux montrent forcement la meme chose.
 */
export function effectLineColor(
  effect: DmxEffect,
  attribute: EffectAttribute,
  v: number
): RgbColor | null {
  switch (attribute) {
    // "dimmer" sur une cellule RGB sans canal d'intensite (chaque zone d'un
    // ruban) : l'intensite devient un fondu bgColor -> color, seule facon de
    // faire varier la luminosite d'une LED qui n'a que trois canaux.
    case "dimmer":
      return lerpRgb(
        effect.bgColor ?? { r: 0, g: 0, b: 0 },
        effect.color ?? { r: 255, g: 255, b: 255 },
        v
      );
    case "color":
      return lerpRgb(
        effect.color ?? { r: 0, g: 0, b: 0 },
        effect.colorTo ?? { r: 255, g: 255, b: 255 },
        v
      );
    case "hue": {
      const from = effect.hueFrom ?? 0;
      const to = effect.hueTo ?? 360;
      return hsvToRgb(from + (to - from) * v, effect.saturation ?? 100, 100);
    }
    default:
      return null;
  }
}

/** Teinte (degres, cyclique) + saturation/valeur en % -> RGB 0..255. */
export function hsvToRgb(hueDeg: number, satPct: number, valPct: number): RgbColor {
  const h = ((hueDeg % 360) + 360) % 360;
  const sv = Math.max(0, Math.min(1, satPct / 100));
  const vv = Math.max(0, Math.min(1, valPct / 100));
  const c = vv * sv;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vv - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Interpolation lineaire entre deux couleurs. Le resultat n'est PAS arrondi :
 *  la partie fractionnaire est precisement ce que le tramage exploite ensuite. */
export function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  };
}
