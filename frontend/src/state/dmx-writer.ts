// Point de passage UNIQUE des écritures DMX du frontend.
//
// Pourquoi un seul chemin : la garde de la chambre s'applique ici (un canal d'un
// projecteur verrouillé est refusé, quelle que soit la source), l'écho local est
// posé ici (l'interface réagit avant le réseau), et le regroupement des écritures
// se fait ici — un glissement de fader émet ~60 événements par seconde, et un
// POST par événement saturait les ~6 connexions du navigateur (la position finale
// arrivait en dernier).
//
// Mécanique : clamp 0-255 → garde → (programmer : marquage des valeurs actives)
// → atténuation du Grand Master → patchLocal (écho) → tampon canal → dernière
// valeur. Le PREMIER envoi part immédiatement (pas de latence perçue), puis le
// tampon est vidé toutes les 40 ms en UN `POST /api/universe { values }` ; le
// minuteur s'arrête dès qu'il n'y a plus rien à envoyer.
import { api } from "../lib/api";
import { currentPatch, lockedChannels } from "../lib/patch";
import { log } from "./app";
import { attenuateForMaster, markActive } from "./programmer";
import { patchLocal } from "./universe";

export type WriteOptions = {
  /** true → marque les canaux comme valeurs actives du programmer. */
  programmer?: boolean;
  /** Interne (Grand Master / blackout) : les valeurs sont déjà atténuées, ne pas les re-atténuer. */
  bypassMaster?: boolean;
};

/** Cadence de vidage du tampon : 25 envois/s, bien au-delà de ce que l'œil distingue. */
export const FLUSH_INTERVAL_MS = 40;

// Tampon canal → dernière valeur demandée (les positions intermédiaires d'un
// glissement n'ont aucun intérêt une fois dépassées).
const pending = new Map<number, number>();
let timer: ReturnType<typeof setInterval> | null = null;
// Les envois sont chaînés : un lot ne part qu'après le précédent, pour que deux
// POST ne se doublent pas sur le réseau et n'arrivent pas dans le désordre.
let chain: Promise<void> = Promise.resolve();
const stats = { posts: 0, channels: 0, errors: 0 };

const clampDmx = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Écrit des canaux (0-255). Ignore silencieusement les canaux hors univers et ceux
 * d'un projecteur verrouillé ; renvoie le nombre de canaux acceptés.
 */
export function writeChannels(entries: Array<[number, number]>, opts: WriteOptions = {}): number {
  if (!entries.length) return 0;
  const locked = lockedChannels(currentPatch());
  const accepted: Array<[number, number]> = [];
  for (const [channel, value] of entries) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 512) continue;
    if (!Number.isFinite(value)) continue;
    if (locked.has(channel)) continue;
    accepted.push([channel, clampDmx(value)]);
  }
  if (!accepted.length) return 0;

  if (opts.programmer) markActive(accepted);
  const output = opts.bypassMaster ? accepted : attenuateForMaster(accepted);

  patchLocal(output);
  for (const [channel, value] of output) pending.set(channel, value);
  schedule();
  return accepted.length;
}

export function writeChannel(channel: number, value: number, opts?: WriteOptions): number {
  return writeChannels([[channel, value]], opts);
}

const schedule = (): void => {
  if (timer !== null) return;
  void flush();
  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
};

const flush = (): Promise<void> => {
  if (pending.size === 0) {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    return chain;
  }
  const batch: Record<number, number> = {};
  for (const [channel, value] of pending) batch[channel] = value;
  pending.clear();
  const count = Object.keys(batch).length;

  chain = chain
    .then(() => api.universe.setMany(batch))
    .then(
      () => {
        stats.posts += 1;
        stats.channels += count;
      },
      (err: unknown) => {
        stats.errors += 1;
        log("error", `Écriture DMX échouée : ${err instanceof Error ? err.message : String(err)}`);
      }
    );
  return chain;
};

/** Vide le tampon tout de suite et attend l'envoi (tests, avant un STORE). */
export async function flushNow(): Promise<void> {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  await flush();
}

/** Compteurs pour la fenêtre Setup / le débogage. */
export function writerStats(): { posts: number; channels: number; errors: number; pending: number; timerActive: boolean } {
  return { ...stats, pending: pending.size, timerActive: timer !== null };
}
