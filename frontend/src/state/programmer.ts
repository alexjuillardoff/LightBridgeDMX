// Le programmer du pupitre : sélection courante, valeurs actives (posées depuis
// le dernier Clear), groupe de fonctions / page d'encodeurs / couche / readout,
// Grand Master et blackout.
//
// C'est la cible des encodeurs, de la ligne de commande, du color picker et de
// STORE. La garde de la chambre s'applique ici aussi : un projecteur verrouillé
// n'entre JAMAIS dans la sélection, donc aucun geste du programmer ne l'atteint
// (et le writer le refuserait de toute façon).
//
// Grand Master / blackout (§4.7.1) : le backend n'a pas de master. Quand GM passe
// sous 100 %, on photographie une fois les valeurs NON atténuées des canaux
// DIMMABLE de tous les projecteurs non verrouillés (gmSnapshot), puis on écrit
// round(snapshot × gm/100). Les écritures (programmer, playback, presets) pendant
// GM < 100 mettent à jour le snapshot et sortent atténuées — c'est le writer qui
// appelle attenuateForMaster(). GM revenu à 100 → snapshot rejoué puis oublié.
// Blackout = même mécanique avec un facteur 0. Les canaux non atténuables
// (pan, tilt, gobo, roues…) ne bougent jamais.
import { useMemo } from "react";
import type { AttrKey, FeatureGroupId, Readout } from "../lib/attributes";
import { channelsForAttr } from "../lib/attributes";
import { currentPatch, dimmableChannels, patchIndex, usePatchById } from "../lib/patch";
import type { PatchedFixture } from "../lib/patch";
import { createStore, shallowEqual, useStore } from "../lib/store";
import { log } from "./app";
import { writeChannels } from "./dmx-writer";
import { getValues, universeStore } from "./universe";

export type Layer = "absolute" | "relative" | "fade" | "delay";
export type LayerGroup = "values" | "phaserOverall" | "phaserSteps";
export type Align = "off" | "<" | ">" | "<>";
export type LinkMode = "single" | "feature";

export type ProgrammerState = {
  /** Ids, dans l'ordre de sélection (porte la phase des phasers). */
  selection: string[];
  /** Canal absolu → valeur posée par le programmer depuis le dernier Clear (non atténuée). */
  active: Record<number, number>;
  featureGroup: FeatureGroupId;
  /** Page d'encodeurs dans le groupe (4 encodeurs par page), 0-indexée. */
  encoderPage: number;
  layerGroup: LayerGroup;
  layer: Layer;
  readout: Readout;
  sync: boolean;
  singleStep: boolean;
  align: Align;
  link: LinkMode;
  /** 0..100, 100 par défaut. */
  grandMaster: number;
  blackout: boolean;
  highlight: boolean;
};

export const programmerStore = createStore<ProgrammerState>({
  selection: [],
  active: {},
  featureGroup: "dimmer",
  encoderPage: 0,
  layerGroup: "values",
  layer: "absolute",
  readout: "natural",
  sync: false,
  singleStep: false,
  align: "off",
  link: "single",
  grandMaster: 100,
  blackout: false,
  highlight: false
});

const clampDmx = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

// ─── Sélection ──────────────────────────────────────────────────────────────

// Ne garde que des ids connus du patch, non verrouillés, sans doublon, dans l'ordre donné.
const sanitize = (ids: string[]): string[] => {
  const byId = patchIndex(currentPatch());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (!f || f.locked || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

export type SelectMode = "replace" | "add" | "remove" | "toggle";

/** Modifie la sélection. Les projecteurs verrouillés (ou inconnus) sont ignorés. */
export function select(ids: string[], mode: SelectMode = "replace"): void {
  const wanted = sanitize(ids);
  programmerStore.set((prev) => {
    let next: string[];
    switch (mode) {
      case "add":
        next = [...prev.selection, ...wanted.filter((id) => !prev.selection.includes(id))];
        break;
      case "remove": {
        const drop = new Set(wanted);
        next = prev.selection.filter((id) => !drop.has(id));
        break;
      }
      case "toggle": {
        next = prev.selection.slice();
        for (const id of wanted) {
          const idx = next.indexOf(id);
          if (idx >= 0) next.splice(idx, 1);
          else next.push(id);
        }
        break;
      }
      default:
        next = wanted;
    }
    return shallowEqual(next, prev.selection) ? prev : { ...prev, selection: next };
  });
}

/** Sélectionne tous les projecteurs pilotables, dans l'ordre des FID. */
export function selectAll(): void {
  select(currentPatch().filter((f) => !f.locked).map((f) => f.id));
}

export function clearSelection(): void {
  programmerStore.set((prev) => (prev.selection.length ? { ...prev, selection: [] } : prev));
}

/** Inverse la sélection parmi les projecteurs pilotables (overlay Selection). */
export function invertSelection(): void {
  const current = new Set(programmerStore.get().selection);
  select(currentPatch().filter((f) => !f.locked && !current.has(f.id)).map((f) => f.id));
}

// Next / Prev de l'overlay Selection : on parcourt les projecteurs pilotables un
// par un, en partant du premier sélectionné (ou du début s'il n'y a rien).
const step = (direction: 1 | -1): void => {
  const pilotable = currentPatch().filter((f) => !f.locked);
  if (!pilotable.length) return;
  const first = programmerStore.get().selection[0];
  const idx = first ? pilotable.findIndex((f) => f.id === first) : -1;
  const next = idx < 0 ? (direction === 1 ? 0 : pilotable.length - 1) : (idx + direction + pilotable.length) % pilotable.length;
  select([pilotable[next].id]);
};
export function selectNext(): void {
  step(1);
}
export function selectPrev(): void {
  step(-1);
}

/**
 * Cycle Clear de MA3 : 1er appui = sélection vidée, 2e = valeurs actives oubliées
 * (elles RESTENT sur scène, rien n'est écrit), 3e = rien. Renvoie ce qui a été fait.
 */
export function clear(): "selection" | "active" | "nothing" {
  const state = programmerStore.get();
  if (state.selection.length) {
    programmerStore.set({ ...state, selection: [] });
    return "selection";
  }
  if (Object.keys(state.active).length) {
    programmerStore.set({ ...state, active: {} });
    return "active";
  }
  return "nothing";
}

/** Vide sélection et valeurs actives d'un coup (ClearAll). */
export function clearAll(): void {
  programmerStore.set((prev) =>
    prev.selection.length || Object.keys(prev.active).length ? { ...prev, selection: [], active: {} } : prev
  );
}

// ─── Valeurs actives ────────────────────────────────────────────────────────

/** Marque des canaux comme valeurs actives du programmer (appelé par le writer, option `programmer`). */
export function markActive(entries: Array<[number, number]>): void {
  programmerStore.set((prev) => {
    let active = prev.active;
    let changed = false;
    for (const [channel, value] of entries) {
      if (active[channel] === value) continue;
      if (!changed) {
        active = { ...active };
        changed = true;
      }
      active[channel] = value;
    }
    return changed ? { ...prev, active } : prev;
  });
}

/** Oublie les valeurs actives de certains canaux (sans rien écrire). */
export function forgetActive(channels: number[]): void {
  programmerStore.set((prev) => {
    if (!channels.some((ch) => ch in prev.active)) return prev;
    const active = { ...prev.active };
    channels.forEach((ch) => delete active[ch]);
    return { ...prev, active };
  });
}

/**
 * Pose un attribut sur la sélection (ou `ids`). value : DMX 0-255 (ou % si unit = "percent").
 * `relative` ajoute la valeur à la valeur courante (non atténuée) de chaque canal.
 * "dimmer" sans canal intensity retombe sur r+g+b (lib/attributes). Renvoie le nombre de canaux écrits.
 */
export function setAttribute(
  attr: AttrKey,
  value: number,
  opts: { ids?: string[]; unit?: "dmx" | "percent"; relative?: boolean } = {}
): number {
  const ids = opts.ids ?? programmerStore.get().selection;
  if (!ids.length) return 0;
  const byId = patchIndex(currentPatch());
  const dmx = opts.unit === "percent" ? (value / 100) * 255 : value;
  const entries: Array<[number, number]> = [];
  for (const id of ids) {
    const fixture = byId.get(id);
    if (!fixture || fixture.locked) continue;
    for (const channel of channelsForAttr(fixture, attr)) {
      const target = opts.relative ? referenceValue(channel) + dmx : dmx;
      entries.push([channel, clampDmx(target)]);
    }
  }
  if (!entries.length) return 0;
  return writeChannels(entries, { programmer: true });
}

// ─── Réglages de l'encoder bar ──────────────────────────────────────────────

export function setFeatureGroup(g: FeatureGroupId): void {
  programmerStore.set((prev) => (prev.featureGroup === g ? prev : { ...prev, featureGroup: g, encoderPage: 0 }));
}
export function setEncoderPage(p: number): void {
  const page = Math.max(0, Math.floor(p));
  programmerStore.set((prev) => (prev.encoderPage === page ? prev : { ...prev, encoderPage: page }));
}
export function setLayer(l: Layer): void {
  programmerStore.set((prev) => (prev.layer === l ? prev : { ...prev, layer: l }));
}
export function setLayerGroup(g: LayerGroup): void {
  programmerStore.set((prev) => (prev.layerGroup === g ? prev : { ...prev, layerGroup: g }));
}
export function setReadout(r: Readout): void {
  programmerStore.set((prev) => (prev.readout === r ? prev : { ...prev, readout: r }));
}
export function setSync(on: boolean): void {
  programmerStore.set((prev) => (prev.sync === on ? prev : { ...prev, sync: on }));
}
export function setSingleStep(on: boolean): void {
  programmerStore.set((prev) => (prev.singleStep === on ? prev : { ...prev, singleStep: on }));
}
export function setAlign(a: Align): void {
  programmerStore.set((prev) => (prev.align === a ? prev : { ...prev, align: a }));
}
export function setLink(l: LinkMode): void {
  programmerStore.set((prev) => (prev.link === l ? prev : { ...prev, link: l }));
}
export function setHighlight(on: boolean): void {
  programmerStore.set((prev) => (prev.highlight === on ? prev : { ...prev, highlight: on }));
}
export function toggleHighlight(): boolean {
  const next = !programmerStore.get().highlight;
  setHighlight(next);
  return next;
}

// ─── Grand Master / blackout ────────────────────────────────────────────────

// Photo des valeurs NON atténuées des canaux DIMMABLE, prise au moment où le
// master quitte 100 %. null tant que le master est à 100 % et sans blackout.
let gmSnapshot: Map<number, number> | null = null;

/** Facteur du master : 0 en blackout, sinon GM/100. */
export function masterFactor(): number {
  const s = programmerStore.get();
  return s.blackout ? 0 : s.grandMaster / 100;
}

/** true si une photo des valeurs non atténuées est en cours (master < 100 %). */
export function masterSnapshotActive(): boolean {
  return gmSnapshot !== null;
}

/** Valeur non atténuée d'un canal : la photo du master si elle existe, sinon l'univers. */
export function referenceValue(channel: number): number {
  const held = gmSnapshot?.get(channel);
  if (held !== undefined) return held;
  return getValues()[channel - 1] ?? 0;
}

/** Les 512 valeurs NON atténuées : l'univers, corrigé par la photo du master s'il y en a une.
 *  C'est ce que STORE doit mémoriser (une scène enregistrée GM à 50 % ne doit pas sortir à moitié). */
export function unattenuatedValues(): number[] {
  const values = getValues();
  if (!gmSnapshot) return values;
  const out = values.slice();
  for (const [channel, value] of gmSnapshot) out[channel - 1] = value;
  return out;
}

const takeSnapshot = (): Map<number, number> => {
  const values = getValues();
  const snapshot = new Map<number, number>();
  for (const channel of dimmableChannels(currentPatch())) snapshot.set(channel, values[channel - 1] ?? 0);
  return snapshot;
};

// Applique le facteur courant : photo au départ, sortie atténuée, rejeu au retour à 100 %.
const applyMaster = (): void => {
  const factor = masterFactor();
  if (factor >= 1) {
    if (!gmSnapshot) return;
    const restore: Array<[number, number]> = [...gmSnapshot].map(([channel, value]) => [channel, value]);
    gmSnapshot = null;
    writeChannels(restore, { bypassMaster: true });
    return;
  }
  if (!gmSnapshot) {
    // Avant le premier tick, l'univers local est à zéro : photographier maintenant
    // reviendrait à éteindre tout le plateau au retour à 100 %. On attend.
    if (!universeStore.get().received) {
      log("warn", "Grand Master ignoré : univers DMX pas encore reçu");
      return;
    }
    gmSnapshot = takeSnapshot();
  }
  const output: Array<[number, number]> = [...gmSnapshot].map(([channel, value]) => [channel, Math.round(value * factor)]);
  writeChannels(output, { bypassMaster: true });
};

/** Règle le Grand Master (0..100) — voir §4.7.1. */
export function setGrandMaster(pct: number): void {
  const gm = Math.max(0, Math.min(100, Math.round(pct)));
  programmerStore.set((prev) => (prev.grandMaster === gm ? prev : { ...prev, grandMaster: gm }));
  applyMaster();
}

/** Blackout : bouton à bascule, facteur 0 sur les canaux DIMMABLE. */
export function setBlackout(on: boolean): void {
  programmerStore.set((prev) => (prev.blackout === on ? prev : { ...prev, blackout: on }));
  applyMaster();
}

/**
 * Appelé par le writer pour chaque écriture normale : quand le master est sous
 * 100 %, met à jour la photo des canaux DIMMABLE et renvoie les valeurs atténuées.
 * Hors master, renvoie les entrées telles quelles.
 */
export function attenuateForMaster(entries: Array<[number, number]>): Array<[number, number]> {
  const factor = masterFactor();
  if (factor >= 1) return entries;
  if (!gmSnapshot) {
    if (!universeStore.get().received) return entries;
    gmSnapshot = takeSnapshot();
  }
  const snapshot = gmSnapshot;
  const dimmable = dimmableChannels(currentPatch());
  return entries.map(([channel, value]) => {
    if (!dimmable.has(channel)) return [channel, value];
    snapshot.set(channel, value);
    return [channel, Math.round(value * factor)];
  });
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Abonnement générique à une sélection de l'état du programmer. */
export function useProgrammer<S>(selector: (s: ProgrammerState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(programmerStore, selector, equal);
}

const selSelection = (s: ProgrammerState) => s.selection;
const selActive = (s: ProgrammerState) => s.active;

export function useSelection(): string[] {
  return useStore(programmerStore, selSelection);
}

/** Projecteurs sélectionnés, dans l'ordre de sélection (même référence tant que rien ne change). */
export function useSelectedFixtures(): PatchedFixture[] {
  const selection = useSelection();
  const byId = usePatchById();
  return useMemo(
    () => selection.map((id) => byId.get(id)).filter((f): f is PatchedFixture => f !== undefined),
    [selection, byId]
  );
}

/** Lecture sans abonnement. */
export function isSelected(id: string): boolean {
  return programmerStore.get().selection.includes(id);
}

/** Hook par ligne : ne re-rend que si CE projecteur entre ou sort de la sélection. */
export function useIsSelected(id: string): boolean {
  const selector = useMemo(() => (s: ProgrammerState) => s.selection.includes(id), [id]);
  return useStore(programmerStore, selector);
}

export function useActiveChannels(): Record<number, number> {
  return useStore(programmerStore, selActive);
}

/** Lecture sans abonnement. */
export function isActive(channel: number): boolean {
  return channel in programmerStore.get().active;
}

/** Hook par cellule : ne re-rend que si CE canal devient actif ou inactif. */
export function useIsActive(channel: number): boolean {
  const selector = useMemo(() => (s: ProgrammerState) => channel in s.active, [channel]);
  return useStore(programmerStore, selector);
}

/** Projecteurs ayant au moins une valeur active (mode « Prog Only » de la fixture sheet). */
export function fixturesWithActiveValues(patch: PatchedFixture[], active: Record<number, number>): Set<string> {
  const out = new Set<string>();
  const channels = Object.keys(active).map(Number);
  if (!channels.length) return out;
  for (const f of patch) {
    const start = f.address;
    const end = f.address + f.span - 1;
    if (channels.some((ch) => ch >= start && ch <= end)) out.add(f.id);
  }
  return out;
}
