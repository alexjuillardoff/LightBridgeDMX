// Store de l'univers DMX : les 512 canaux, alimentés par les ticks WebSocket (30 Hz).
//
// Invariant : aucun contexte React ne porte ces valeurs. Une cellule de sheet
// s'abonne à SON canal (useChannel) et ne se réveille que si lui change ; le
// reste de l'interface ne voit jamais passer les ticks.
//
// L'écho local du writer (patchLocal) écrit la valeur demandée tout de suite,
// puis la protège ~250 ms contre les ticks qui porteraient encore l'ancienne
// valeur (le POST groupé part au plus tard 40 ms après) : un fader reste fluide
// à l'écran au lieu de trembler entre l'ancienne et la nouvelle valeur.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { UniverseState } from "@lightbridgedmx/shared";
import { createStore, shallowEqual, useStore } from "../lib/store";

export type UniverseSnapshot = { values: number[]; fps: number; timestamp: string; received: boolean };

export const CHANNEL_COUNT = 512;

const zeros = (): number[] => new Array<number>(CHANNEL_COUNT).fill(0);

export const universeStore = createStore<UniverseSnapshot>({
  values: zeros(),
  fps: 0,
  timestamp: "",
  received: false
});

// Canaux récemment écrits en local : valeur attendue et date limite de protection.
const ECHO_HOLD_MS = 250;
const echo = new Map<number, { value: number; until: number }>();
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Applique un tick WebSocket (appelé par realtime.ts). */
export function applyTick(state: UniverseState): void {
  let values = state.values.length === CHANNEL_COUNT ? state.values : state.values.slice(0, CHANNEL_COUNT);
  if (values.length < CHANNEL_COUNT) values = [...values, ...new Array<number>(CHANNEL_COUNT - values.length).fill(0)];

  if (echo.size) {
    const t = now();
    let copy: number[] | null = null;
    for (const [channel, hold] of echo) {
      if (hold.until < t) {
        echo.delete(channel);
        continue;
      }
      if (values[channel - 1] !== hold.value) {
        if (!copy) copy = values.slice();
        copy[channel - 1] = hold.value;
      }
    }
    if (copy) values = copy;
  }

  universeStore.set({ values, fps: state.fps, timestamp: state.timestamp, received: true });
}

/** Écho local du writer : pose les valeurs demandées sans attendre le prochain tick. */
export function patchLocal(entries: Array<[channel: number, value: number]>): void {
  const snapshot = universeStore.get();
  const until = now() + ECHO_HOLD_MS;
  let next: number[] | null = null;
  for (const [channel, value] of entries) {
    if (channel < 1 || channel > CHANNEL_COUNT) continue;
    echo.set(channel, { value, until });
    const current = (next ?? snapshot.values)[channel - 1];
    if (current === value) continue;
    if (!next) next = snapshot.values.slice();
    next[channel - 1] = value;
  }
  if (next) universeStore.set({ ...snapshot, values: next });
}

/** Lecture des 512 valeurs sans abonnement (actions, STORE, writer). */
export function getValues(): number[] {
  return universeStore.get().values;
}

/** Valeur d'un canal (1-512) sans abonnement. */
export function getValue(channel: number): number {
  return universeStore.get().values[channel - 1] ?? 0;
}

/** Abonnement à UN canal (1-512) : la cellule ne re-rend que si sa valeur change. */
export function useChannel(channel: number): number {
  const getSnapshot = useCallback(() => universeStore.get().values[channel - 1] ?? 0, [channel]);
  return useSyncExternalStore(universeStore.subscribe, getSnapshot, getSnapshot);
}

/** Abonnement à une liste de canaux (comparaison shallowEqual : même tableau tant que rien ne bouge). */
export function useChannels(channels: number[]): number[] {
  // La clé textuelle rend la liste (et donc le sélecteur) stable d'un rendu à
  // l'autre pour un même contenu, même si l'appelant passe un tableau neuf.
  const key = channels.join(",");
  const list = useMemo(() => (key ? key.split(",").map(Number) : []), [key]);
  const selector = useCallback((s: UniverseSnapshot) => list.map((c) => s.values[c - 1] ?? 0), [list]);
  return useStore(universeStore, selector, shallowEqual);
}

const selectMeta = (s: UniverseSnapshot): { fps: number; received: boolean } => ({ fps: s.fps, received: s.received });

/** Cadence annoncée par le backend et réception d'au moins un tick (ne re-rend pas à 30 Hz). */
export function useUniverseMeta(): { fps: number; received: boolean } {
  return useStore(universeStore, selectMeta, shallowEqual);
}

/** Nombre de canaux non nuls (indicateur de la fenêtre Setup). */
export function countActiveChannels(values: number[] = getValues()): number {
  let n = 0;
  for (const v of values) if (v > 0) n += 1;
  return n;
}
