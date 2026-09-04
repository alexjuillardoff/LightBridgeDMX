// =============================================================================
// EffectRunner : la boucle qui fait tourner les effets DMX.
//
// Un effet lance ici « possede » les canaux de sa selection jusqu'a son arret,
// comme un executeur sur un pupitre. A ~30 Hz il evalue ses formes et ecrit dans
// l'univers ; a l'arret il rend les canaux a la valeur qu'ils avaient avant.
//
// Rien n'est persiste : un redemarrage du backend coupe tous les effets. C'est
// voulu — un effet qui se rallume tout seul au petit matin sur un projecteur que
// personne ne regarde est une mauvaise surprise, pas une fonctionnalite.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  DmxEffect,
  EffectLine,
  EffectSpatial,
  Fixture,
  Point3D,
  RgbColor,
  RunningEffect,
  SmartLight
} from "@lightbridgedmx/shared";
import { DmxService } from "../dmx";
import { EffectCell, resolveCells } from "./cells";
import { evaluateDmxEffect } from "./engine";

type Run = {
  id: string;
  effect: DmxEffect;
  fixtureIds: string[];
  cells: EffectCell[];
  /** Distribution de phase spatiale pre-calculee, ou null pour la distribution par rang. */
  positions: number[] | null;
  /** Instant de depart (secondes), origine du temps de la forme d'onde. */
  t0: number;
  startedAt: string;
  /** Valeur de chaque canal possede AVANT le lancement. Sert deux fois : de
   *  reference au mode relatif, et de valeur a restaurer a l'arret. */
  base: Map<number, number>;
  /** Report d'erreur du tramage temporel, par canal (voir ditherTo8bit). */
  carry: Map<number, number>;
};

export class EffectRunner {
  private readonly logger: FastifyBaseLogger;
  private readonly dmx: DmxService;
  private readonly runs = new Map<string, Run>();
  /** Desabonnement du producteur de trame DMX (voir start). */
  private unsubscribe: (() => void) | null = null;
  /** Fournisseurs de patch, injectes au demarrage : le runner ne parle pas a la base. */
  private getFixtures: () => Promise<Fixture[]> = async () => [];
  private getSmartLights: () => SmartLight[] = () => [];

  constructor(logger: FastifyBaseLogger, dmx: DmxService) {
    this.logger = logger.child({ service: "effects" });
    this.dmx = dmx;
  }

  /**
   * Branche le moteur sur la boucle de sortie DMX.
   *
   * Le runner n'a deliberement PAS d'horloge a lui. Un setInterval de 33 ms a cote
   * d'une sortie a 30 Hz derive contre elle : les deux cadences battent l'une contre
   * l'autre et il sort regulierement une trame ou l'effet n'a pas encore recalcule,
   * donc une valeur repetee. Mesure sur un fondu sinus : 4 trames repetees sur 90,
   * soit un accroc toutes les 0,75 s — parfaitement visible sur un PAR.
   *
   * En se calant sur `onBeforeFrame`, chaque trame envoyee porte une valeur fraiche,
   * calculee une seule fois. C'est la regle d'un pupitre : une seule horloge.
   */
  start(getFixtures: () => Promise<Fixture[]>, getSmartLights: () => SmartLight[]): void {
    this.getFixtures = getFixtures;
    this.getSmartLights = getSmartLights;
    if (!this.unsubscribe) this.unsubscribe = this.dmx.onBeforeFrame(() => this.tick());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopAll();
  }

  /** Lance un effet sur une selection. Renvoie undefined si la selection ne
   *  contient aucune cellule pilotable — mieux vaut le dire que faire tourner une
   *  boucle qui n'ecrit nulle part. */
  async run(effect: DmxEffect, fixtureIds: string[]): Promise<RunningEffect | undefined> {
    const fixtures = await this.getFixtures();
    const cells = resolveCells(fixtureIds, fixtures, this.getSmartLights());
    if (cells.length === 0) return undefined;

    // Un seul effet a la fois par projecteur : relancer sur une selection qui
    // recoupe un effet en cours arrete l'ancien. Sans cette regle, deux effets se
    // disputeraient les memes canaux a 30 Hz et le resultat serait illisible.
    const targeted = new Set(fixtureIds);
    for (const [id, run] of this.runs) {
      if (run.fixtureIds.some((f) => targeted.has(f))) this.stopRun(id);
    }

    // Photo de l'univers AVANT le lancement : une seule lecture, puis on y pioche
    // les canaux vises. C'est la reference du mode relatif et ce qu'on restaurera.
    const snapshot = this.dmx.getUniverseSnapshot();
    const base = new Map<number, number>();
    for (const cell of cells) {
      for (const ch of Object.values(cell.channels)) {
        if (ch !== undefined) base.set(ch, snapshot[ch - 1] ?? 0);
      }
    }

    const run: Run = {
      id: randomUUID(),
      effect,
      fixtureIds,
      cells,
      positions: spatialPositions(cells, effect.spatial, effect.sides, effect.matricks?.groups ?? 1),
      t0: Date.now() / 1000,
      startedAt: new Date().toISOString(),
      base,
      carry: new Map()
    };
    this.runs.set(run.id, run);
    this.logger.info(
      { id: run.id, fixtures: fixtureIds.length, cells: cells.length, lines: effect.lines.length },
      "Effet lance"
    );
    return toRunning(run);
  }

  /** Arrete un effet et rend ses canaux a leur valeur d'avant. */
  stopRun(id: string): boolean {
    const run = this.runs.get(id);
    if (!run) return false;
    this.runs.delete(id);
    // Restauration : sans elle, la selection reste figee sur la derniere trame de
    // l'effet — une lyre bloquee a mi-course, un bandeau arrete sur un motif.
    for (const [channel, value] of run.base) {
      this.dmx.setChannel(channel, value, `effect-stop:${run.id}`);
    }
    this.logger.info({ id }, "Effet arrete");
    return true;
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stopRun(id);
  }

  list(): RunningEffect[] {
    return [...this.runs.values()].map(toRunning);
  }

  /** Effets en cours qui touchent au moins un des projecteurs donnes. */
  runningFor(fixtureIds: string[]): RunningEffect[] {
    const wanted = new Set(fixtureIds);
    return [...this.runs.values()]
      .filter((r) => r.fixtureIds.some((f) => wanted.has(f)))
      .map(toRunning);
  }

  // ── Boucle ────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.runs.size === 0) return;
    const now = Date.now() / 1000;

    for (const run of this.runs.values()) {
      const frames = evaluateDmxEffect(
        run.effect,
        run.cells.length,
        now - run.t0,
        run.positions ?? undefined
      );

      // On accumule canal -> valeur REELLE (non arrondie) pour toute la trame, puis
      // on trame et on ecrit en blocs contigus. Ecrire canal par canal ferait 150
      // appels par trame sur le seul bandeau, soit 9000 par seconde a 60 Hz.
      const out = new Map<number, number>();
      for (let li = 0; li < run.effect.lines.length; li++) {
        const line = run.effect.lines[li];
        const frame = frames[li];
        for (let ci = 0; ci < run.cells.length; ci++) {
          if (frame.skipped[ci]) continue;
          this.writeCell(out, run, run.cells[ci], line, frame.values[ci]);
        }
      }
      flushBlocks(this.dmx, ditherTo8bit(out, run.carry), `effect:${run.id}`);
    }
  }

  /** Traduit la valeur d'une ligne en ecritures de canaux pour une cellule. */
  private writeCell(
    out: Map<number, number>,
    run: Run,
    cell: EffectCell,
    line: EffectLine,
    value: number
  ): void {
    // La courbe ne s'applique qu'aux intensites : deplacer une lyre ou balayer une
    // teinte n'a rien de photometrique, les courber deformerait le mouvement.
    const v = line.attribute === "dimmer" ? applyCurve(value, run.effect.curve) : value;
    const channel = cell.channels[line.attribute];

    if (channel !== undefined) {
      if (line.mode === "relative") {
        // Relatif : la bande low..high devient une AMPLITUDE de part et d'autre de
        // la valeur de depart. low 0 / high 100 balaie donc toute la course, et
        // low 40 / high 60 fait vibrer la lyre autour de sa position.
        const centre = (line.low + line.high) / 200;
        const base = run.base.get(channel) ?? 0;
        out.set(channel, clampF(base + (v - centre) * 255));
      } else {
        out.set(channel, clampF(v * 255));
      }
      return;
    }

    // Pas de canal dedie. Trois cas se resolvent quand meme sur le trio R/G/B —
    // et c'est ce qui permet a un effet ecrit pour une lyre de jouer sur un ruban.
    if (cell.channels.red === undefined) return;

    const e = run.effect;
    let rgb: RgbColor | null = null;
    switch (line.attribute) {
      // "dimmer" sur une cellule RGB sans canal d'intensite (chaque zone d'un
      // ruban) : l'intensite devient un fondu bgColor -> color, seule facon de
      // faire varier la luminosite d'une LED qui n'a que trois canaux.
      case "dimmer":
        rgb = lerpRgb(e.bgColor ?? { r: 0, g: 0, b: 0 }, e.color ?? { r: 255, g: 255, b: 255 }, v);
        break;
      case "color":
        rgb = lerpRgb(e.color ?? { r: 0, g: 0, b: 0 }, e.colorTo ?? { r: 255, g: 255, b: 255 }, value);
        break;
      case "hue": {
        const from = e.hueFrom ?? 0;
        const to = e.hueTo ?? 360;
        rgb = hsvToRgb(from + (to - from) * value, e.saturation ?? 100, 100);
        break;
      }
      default:
        return; // pan/tilt/red/... sans canal : la cellule ne sait pas jouer cette ligne
    }

    out.set(cell.channels.red, rgb.r);
    if (cell.channels.green !== undefined) out.set(cell.channels.green, rgb.g);
    if (cell.channels.blue !== undefined) out.set(cell.channels.blue, rgb.b);
  }
}

/** Courbe de gradation : convertit une intensite VOULUE (0..1, perceptuelle) en
 *  valeur DMX relative (0..1, photometrique). Voir DmxEffectSchema.curve. */
function applyCurve(v: number, curve: DmxEffect["curve"]): number {
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

function toRunning(run: Run): RunningEffect {
  return {
    id: run.id,
    effect: run.effect,
    fixtureIds: run.fixtureIds,
    cellCount: run.cells.length,
    startedAt: run.startedAt
  };
}

/** Regroupe les canaux a ecrire en blocs contigus et les pousse au DmxService. */
function flushBlocks(dmx: DmxService, out: Map<number, number>, source: string): void {
  if (out.size === 0) return;
  const channels = [...out.keys()].sort((a, b) => a - b);
  let start = channels[0];
  let values: number[] = [out.get(start)!];

  for (let i = 1; i < channels.length; i++) {
    const ch = channels[i];
    if (ch === start + values.length) {
      values.push(out.get(ch)!);
      continue;
    }
    dmx.applyWrite({ address: start, values }, source);
    start = ch;
    values = [out.get(ch)!];
  }
  dmx.applyWrite({ address: start, values }, source);
}

/**
 * Distribution de phase par la geometrie, quand les cellules ont une position 3D.
 *
 * Renvoie null des qu'aucune position n'est connue — cas de toute selection de
 * projecteurs classiques, qui n'ont pas de coordonnees dans le patch : la phase
 * retombe alors sur le rang de la cellule, et les MAtricks reprennent la main.
 */
function spatialPositions(
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

/** Teinte (degres, cyclique) + saturation/valeur en % -> RGB 0..255. */
function hsvToRgb(hueDeg: number, satPct: number, valPct: number): RgbColor {
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
function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  };
}

/**
 * Tramage temporel (dithering) : convertit des valeurs REELLES en octets DMX en
 * repartissant l'erreur d'arrondi sur les trames suivantes.
 *
 * Pourquoi : un canal DMX n'a que 256 niveaux, et sur un fondu lent ces marches se
 * voient — constate sur le bandeau avec une rampe qui n'avancait pourtant que d'un
 * pas par trame. On ne peut pas ajouter de niveaux dans UNE trame ; on peut les
 * creer dans le TEMPS. Pour rendre 189,25 on envoie trois trames a 189 et une a 190 :
 * a 60 Hz l'oeil integre et percoit 189,25. C'est l'equivalent d'environ 10 bits.
 *
 * Methode : diffusion d'erreur. On arrondit `valeur + report`, puis on garde la
 * difference comme report pour la trame suivante. Le report reste borne a ±0,5, donc
 * pas de derive possible, et le motif s'adapte tout seul a la fraction — pas de
 * cycle fixe qui produirait un battement visible.
 *
 * CONDITION : la cadence doit tenir jusqu'au projecteur. Si un maillon en aval
 * decime le flux, il echantillonne le motif au lieu de l'integrer et le tramage se
 * voit alors comme un scintillement. Ici la chaine est a 60 Hz de bout en bout
 * (backend, Art-Net, QLC+, Open DMX USB).
 */
function ditherTo8bit(values: Map<number, number>, carry: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [channel, exact] of values) {
    const target = exact + (carry.get(channel) ?? 0);
    const rounded = target < 0 ? 0 : target > 255 ? 255 : Math.round(target);
    // Report calcule sur la valeur AVANT bornage : sinon un canal colle a 0 ou 255
    // accumulerait une dette qu'il ne pourrait jamais rendre, et le premier
    // mouvement en sens inverse partirait avec plusieurs crans de retard.
    carry.set(channel, clampCarry(target - rounded));
    out.set(channel, rounded);
  }
  return out;
}

/** Borne le report a un demi-cran de part et d'autre. Sans cette borne, une valeur
 *  hors plage prolongee ferait diverger l'accumulateur. */
const clampCarry = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return n < -0.5 ? -0.5 : n > 0.5 ? 0.5 : n;
};

/** Borne une valeur reelle dans la plage DMX, SANS arrondir. */
const clampF = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : n;
};
