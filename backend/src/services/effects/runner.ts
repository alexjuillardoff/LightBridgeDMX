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
  EffectCell,
  EffectLine,
  Fixture,
  RgbColor,
  RunningEffect,
  SmartLight,
  applyCurve,
  effectLineColor,
  evaluateDmxEffect,
  resolveCells,
  spatialPositions
} from "@lightbridgedmx/shared";
import { DmxService } from "../dmx";

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

  /**
   * Remplace les reglages d'un effet EN COURS, sans le relancer.
   *
   * C'est le geste du pupitre : on tourne l'encodeur de vitesse pendant que l'effet
   * tourne, et il change sans repartir de zero. Le relancer aurait remis `t0` a
   * maintenant, donc rendu la phase a son point de depart — un a-coup visible sur
   * le plateau a chaque cran d'encodeur, alors qu'on cherchait justement a regler
   * l'effet en le regardant.
   *
   * Ce qui est conserve : t0 (donc la continuite de la phase), les cellules, la
   * photo des canaux d'avant lancement (reference du mode relatif et valeur a
   * restaurer). Ce qui est recalcule : la distribution spatiale, qui depend des
   * reglages. La selection, elle, ne change pas — modifier la cible, c'est un
   * nouvel effet, pas un reglage.
   */
  updateRun(id: string, effect: DmxEffect): RunningEffect | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    run.effect = effect;
    run.positions = spatialPositions(
      run.cells,
      effect.spatial,
      effect.sides,
      effect.matricks?.groups ?? 1
    );
    // Le report de tramage se rapporte a l'ancienne suite de valeurs : le garder
    // ferait porter l'erreur d'arrondi d'un effet sur le suivant.
    run.carry.clear();
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
      const bytes = run.effect.dither ? ditherTo8bit(out, run.carry) : roundTo8bit(out);
      flushBlocks(this.dmx, bytes, `effect:${run.id}`);
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

      // Un canal d'intensite ne dit rien de la COULEUR. Un projecteur qui a les deux
      // (PAR 56 Lampe : R/G/B + un master) recevait donc un fondu sur son gradateur
      // et gardait la couleur d'avant — souvent noire, donc un effet parfaitement
      // invisible. Quand l'effet declare une couleur, on la pose aussi sur son trio
      // R/G/B : c'est le gradateur qui module, la couleur reste celle qu'on a choisie.
      //
      // Sans couleur declaree, on ne touche a rien : un effet de gradation pose sur
      // une teinte reglee a la main doit la laisser tranquille, comme sur un pupitre.
      if (line.attribute === "dimmer" && run.effect.color && cell.channels.red !== undefined) {
        writeRgb(out, cell, run.effect.color);
      }
      return;
    }

    // Pas de canal dedie. Trois cas se resolvent quand meme sur le trio R/G/B —
    // et c'est ce qui permet a un effet ecrit pour une lyre de jouer sur un ruban.
    // La table de correspondance est partagee avec l'apercu de la fenetre Effets.
    if (cell.channels.red === undefined) return;

    // La courbe n'a de sens que sur le fondu d'intensite ; un balayage de teinte
    // ou un fondu entre deux couleurs se lit sur la valeur brute.
    const rgb = effectLineColor(run.effect, line.attribute, line.attribute === "dimmer" ? v : value);
    // pan/tilt/red/... sans canal : la cellule ne sait pas jouer cette ligne.
    if (!rgb) return;

    writeRgb(out, cell, rgb);
  }
}

/** Pose une couleur sur le trio R/G/B d'une cellule. Vert et bleu peuvent manquer
 *  (une cellule monochrome), le rouge non — l'appelant l'a deja verifie. */
function writeRgb(out: Map<number, number>, cell: EffectCell, rgb: RgbColor): void {
  out.set(cell.channels.red!, rgb.r);
  if (cell.channels.green !== undefined) out.set(cell.channels.green, rgb.g);
  if (cell.channels.blue !== undefined) out.set(cell.channels.blue, rgb.b);
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

/** Conversion simple en octets, sans tramage. */
function roundTo8bit(values: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [channel, exact] of values) {
    out.set(channel, exact < 0 ? 0 : exact > 255 ? 255 : Math.round(exact));
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
