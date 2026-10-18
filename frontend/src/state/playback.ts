// Playback du pupitre : executors (scènes), groupes de sélection et pools de presets.
//
// Répartition de la persistance, volontaire :
//  - scènes et presets → backend (ils appartiennent au spectacle) ;
//  - numéro de slot d'un executor, groupes, références de presets par pool →
//    localStorage (ils appartiennent au poste). Clés lb3.execSlots / lb3.groups / lb3.presetRefs.
//
// Numérotation : les slots sont 1-indexés partout (Executor 1 = slot 1, « Store 1 »),
// comme le vocabulaire du pupitre. Les tableaux renvoyés par les hooks suivent
// l'ordre des slots (index 0 = slot 1).
//
// GO rejoue la scène CÔTÉ FRONTEND (lib/scenes.applySceneAtLevel → writer), jamais
// via /activate : c'est la seule façon d'appliquer le niveau du fader, la garde et
// le Grand Master. OFF ne remet à zéro que les canaux DIMMABLE de la scène.
import { useMemo } from "react";
import type { Preset, Scene } from "@lightbridgedmx/shared";
import { api } from "../lib/api";
import { ATTRIBUTES, FEATURE_GROUPS, attrForCapability } from "../lib/attributes";
import type { FeatureGroupId } from "../lib/attributes";
import { readLocal, writeLocal } from "../lib/local-store";
import { channelsFor, currentPatch, fixtureOf, patchIndex, usePatch } from "../lib/patch";
import type { PatchedFixture } from "../lib/patch";
import { applySceneAtLevel, captureScene, sceneDimmableChannels } from "../lib/scenes";
import { createStore, useStore } from "../lib/store";
import { appStore, refreshPresets, refreshScenes, removeScene, upsertPreset, upsertScene } from "./app";
import type { AppState } from "./app";
import { writeChannels } from "./dmx-writer";
import { programmerStore, select, unattenuatedValues } from "./programmer";
import type { SelectMode } from "./programmer";

export type Group = { slot: number; name: string; fixtureIds: string[] };
export type PresetPool = FeatureGroupId | "all";
export type PresetRef = { id: string; pool: PresetPool; slot: number };
export const EXECUTOR_SLOTS = 20;
export const GROUP_SLOTS = 20;
export const PRESET_SLOTS = 20;
export type Result = { ok: boolean; message: string };

export type PlaybackState = {
  /** slot (1-20) → id de scène, affectation explicite (Store / Assign). */
  execSlots: Record<number, string>;
  /** slot → niveau du fader 0..1 (absent = 1). */
  levels: Record<number, number>;
  /** slot → executor actif (Go sans Off). */
  activeExec: Record<number, boolean>;
  groups: Group[];
  presetRefs: PresetRef[];
};

/** Pools de presets : All puis les 8 groupes de fonctions. */
export const PRESET_POOLS: PresetPool[] = ["all", ...FEATURE_GROUPS.map((g) => g.id)];
export const POOL_LABELS: Record<PresetPool, string> = {
  all: "All",
  dimmer: "Dimmer",
  position: "Position",
  gobo: "Gobo",
  color: "Color",
  beam: "Beam",
  focus: "Focus",
  control: "Control",
  shapers: "Shapers"
};

/** Pool par numéro de groupe de fonctions (1 Dimmer … 8 Shapers) ; 0 ou inconnu → undefined. */
export const poolByIndex = (index: number): PresetPool | undefined => FEATURE_GROUPS.find((g) => g.index === index)?.id;
/** Numéro de pool pour l'affichage « 4.1 » (All = 0). */
export const poolIndex = (pool: PresetPool): number => (pool === "all" ? 0 : FEATURE_GROUPS.find((g) => g.id === pool)?.index ?? 0);
/** Libellé « Preset 4.1 » / « Preset 1 » (pool All). */
export const presetLabel = (pool: PresetPool, slot: number): string =>
  pool === "all" ? `Preset ${slot}` : `Preset ${poolIndex(pool)}.${slot}`;

const ok = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const validSlot = (slot: number, max: number): boolean => Number.isInteger(slot) && slot >= 1 && slot <= max;

// ─── Chargement défensif du localStorage ────────────────────────────────────

const loadSlots = (): Record<number, string> => {
  const raw = readLocal<unknown>("execSlots", {});
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const slot = Number(key);
    if (validSlot(slot, EXECUTOR_SLOTS) && typeof value === "string") out[slot] = value;
  }
  return out;
};

const isGroup = (g: unknown): g is Group =>
  typeof g === "object" &&
  g !== null &&
  validSlot((g as Group).slot, GROUP_SLOTS) &&
  typeof (g as Group).name === "string" &&
  Array.isArray((g as Group).fixtureIds) &&
  (g as Group).fixtureIds.every((id) => typeof id === "string");

const loadGroups = (): Group[] => {
  const raw = readLocal<unknown>("groups", []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isGroup).sort((a, b) => a.slot - b.slot);
};

const isPresetRef = (r: unknown): r is PresetRef =>
  typeof r === "object" &&
  r !== null &&
  typeof (r as PresetRef).id === "string" &&
  PRESET_POOLS.includes((r as PresetRef).pool) &&
  validSlot((r as PresetRef).slot, PRESET_SLOTS);

const loadPresetRefs = (): PresetRef[] => {
  const raw = readLocal<unknown>("presetRefs", []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPresetRef);
};

export const playbackStore = createStore<PlaybackState>({
  execSlots: loadSlots(),
  levels: {},
  activeExec: {},
  groups: loadGroups(),
  presetRefs: loadPresetRefs()
});

// Persistance : seules les tranches qui ont changé d'identité sont réécrites.
let persisted = playbackStore.get();
playbackStore.subscribe(() => {
  const s = playbackStore.get();
  if (s.execSlots !== persisted.execSlots) writeLocal("execSlots", s.execSlots);
  if (s.groups !== persisted.groups) writeLocal("groups", s.groups);
  if (s.presetRefs !== persisted.presetRefs) writeLocal("presetRefs", s.presetRefs);
  persisted = s;
});

/** Remise à zéro des affectations locales (bouton reset de Setup). */
export function resetPlayback(): void {
  playbackStore.set({ execSlots: {}, levels: {}, activeExec: {}, groups: [], presetRefs: [] });
}

// ─── Executors ──────────────────────────────────────────────────────────────

/**
 * Scène de chaque slot (index 0 = slot 1). Les affectations explicites d'abord,
 * puis les scènes orphelines (créées ailleurs, ou depuis un autre navigateur)
 * rangées dans les premiers slots libres — aucune scène ne reste invisible.
 */
export function resolveExecutors(scenes: Scene[], execSlots: Record<number, string>): (Scene | null)[] {
  const slots: (Scene | null)[] = new Array<Scene | null>(EXECUTOR_SLOTS).fill(null);
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const placed = new Set<string>();
  for (const [key, id] of Object.entries(execSlots)) {
    const slot = Number(key);
    const scene = byId.get(id);
    if (!validSlot(slot, EXECUTOR_SLOTS) || !scene || placed.has(id)) continue;
    slots[slot - 1] = scene;
    placed.add(id);
  }
  for (const scene of scenes) {
    if (placed.has(scene.id)) continue;
    const free = slots.indexOf(null);
    if (free < 0) break;
    slots[free] = scene;
    placed.add(scene.id);
  }
  return slots;
}

/** Scène d'un slot, lue sans abonnement. */
export function executorScene(slot: number): Scene | null {
  if (!validSlot(slot, EXECUTOR_SLOTS)) return null;
  return resolveExecutors(appStore.get().scenes, playbackStore.get().execSlots)[slot - 1] ?? null;
}

export type ExecutorView = { slot: number; scene: Scene | null; level: number; active: boolean };

const selScenes = (s: AppState) => s.scenes;
const selPlayback = (s: PlaybackState) => s;

/** Les 20 executors (slot, scène ou null, niveau 0..1, actif). */
export function useExecutors(): ExecutorView[] {
  const scenes = useStore(appStore, selScenes);
  const pb = useStore(playbackStore, selPlayback);
  return useMemo(
    () =>
      resolveExecutors(scenes, pb.execSlots).map((scene, i) => ({
        slot: i + 1,
        scene,
        level: pb.levels[i + 1] ?? 1,
        active: pb.activeExec[i + 1] ?? false
      })),
    [scenes, pb]
  );
}

/**
 * STORE : programmer actif (projecteurs ayant une valeur active) → sinon tout le
 * plateau (non verrouillé). Les valeurs mémorisées sont celles du plateau, non
 * atténuées par le Grand Master. Un slot déjà occupé est réaffecté ; l'ancienne
 * scène n'est pas supprimée (elle réapparaît dans un slot libre).
 */
export async function storeExecutor(slot: number, name?: string): Promise<Result> {
  if (!validSlot(slot, EXECUTOR_SLOTS)) return fail(`Executor ${slot} : hors pool (1-${EXECUTOR_SLOTS})`);
  const patch = currentPatch();
  const activeChannels = Object.keys(programmerStore.get().active).map(Number);
  let targets: PatchedFixture[];
  if (activeChannels.length) {
    const owners = new Set<string>();
    for (const channel of activeChannels) {
      const owner = fixtureOf(patch, channel);
      if (owner) owners.add(owner.id);
    }
    targets = patch.filter((f) => owners.has(f.id) && !f.locked);
  } else {
    targets = patch.filter((f) => !f.locked);
  }
  if (!targets.length) return fail("Rien à mémoriser : aucun projecteur pilotable");

  const steps = captureScene(targets, unattenuatedValues());
  if (!steps.length) return fail("Rien à mémoriser : aucun canal dans l'univers");

  const label = name?.trim() || `Exec ${slot}`;
  try {
    const scene = await api.scenes.create({ name: label, steps });
    const previous = executorScene(slot);
    upsertScene(scene);
    assignExecutor(slot, scene.id);
    playbackStore.set((prev) => ({ ...prev, activeExec: { ...prev.activeExec, [slot]: false } }));
    void refreshScenes().catch(() => undefined);
    const note = previous ? ` — l'ancienne scène « ${previous.name} » reste disponible dans un slot libre` : "";
    return ok(`Executor ${slot} « ${label} » · ${steps.length} projecteur(s) mémorisé(s)${note}`);
  } catch (err) {
    return fail(`Store impossible : ${errorText(err)}`);
  }
}

/** GO : rejoue la scène au niveau du fader via le writer (le GM est appliqué par le writer). */
export async function goExecutor(slot: number): Promise<Result> {
  const scene = executorScene(slot);
  if (!scene) return fail(`Executor ${slot} vide — Store ${slot} pour l'assigner`);
  let level = playbackStore.get().levels[slot] ?? 1;
  // Un Go sur un fader à zéro n'allumerait rien : on le remonte, comme on s'y attend d'un bouton Go+.
  if (level <= 0) level = 1;
  const entries = applySceneAtLevel(scene, patchIndex(currentPatch()), level);
  const written = writeChannels(entries);
  playbackStore.set((prev) => ({
    ...prev,
    levels: { ...prev.levels, [slot]: level },
    activeExec: { ...prev.activeExec, [slot]: true }
  }));
  return ok(`Go Executor ${slot} « ${scene.name} » · ${written} canaux`);
}

/** OFF : canaux DIMMABLE de la scène à 0 (la lyre garde sa position) ; actif = false. */
export function offExecutor(slot: number): Result {
  const scene = executorScene(slot);
  if (!scene) return fail(`Executor ${slot} vide`);
  const channels = sceneDimmableChannels(scene, patchIndex(currentPatch()));
  const written = writeChannels(channels.map((ch): [number, number] => [ch, 0]));
  playbackStore.set((prev) => ({ ...prev, activeExec: { ...prev.activeExec, [slot]: false } }));
  return ok(`Off Executor ${slot} « ${scene.name} » · ${written} canaux à zéro`);
}

/** Fader d'un executor (0..1) : mémorise le niveau et rejoue la scène si l'executor est actif. */
export function setExecutorLevel(slot: number, level: number): void {
  if (!validSlot(slot, EXECUTOR_SLOTS)) return;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const state = playbackStore.get();
  if (state.levels[slot] === clamped) return;
  playbackStore.set({ ...state, levels: { ...state.levels, [slot]: clamped } });
  if (!state.activeExec[slot]) return;
  const scene = executorScene(slot);
  if (!scene) return;
  writeChannels(applySceneAtLevel(scene, patchIndex(currentPatch()), clamped));
}

/** Supprime la scène du slot (DELETE /api/scenes/:id) et libère le slot. */
export async function deleteExecutor(slot: number): Promise<Result> {
  const scene = executorScene(slot);
  if (!scene) return fail(`Executor ${slot} déjà vide`);
  try {
    await api.scenes.delete(scene.id);
  } catch (err) {
    return fail(`Suppression impossible : ${errorText(err)}`);
  }
  removeScene(scene.id);
  playbackStore.set((prev) => {
    const execSlots: Record<number, string> = {};
    for (const [key, id] of Object.entries(prev.execSlots)) if (id !== scene.id) execSlots[Number(key)] = id;
    return { ...prev, execSlots, activeExec: { ...prev.activeExec, [slot]: false } };
  });
  void refreshScenes().catch(() => undefined);
  return ok(`Executor ${slot} « ${scene.name} » supprimé`);
}

/** Renomme : pas de PUT scène côté backend → recrée (POST) + DELETE l'ancienne, même slot. */
export async function labelExecutor(slot: number, name: string): Promise<Result> {
  const scene = executorScene(slot);
  if (!scene) return fail(`Executor ${slot} vide`);
  const label = name.trim();
  if (!label) return fail("Nom vide");
  if (label === scene.name) return ok(`Executor ${slot} s'appelle déjà « ${label} »`);
  try {
    const created = await api.scenes.create({ name: label, steps: scene.steps });
    upsertScene(created);
    assignExecutor(slot, created.id);
    try {
      await api.scenes.delete(scene.id);
      removeScene(scene.id);
    } catch {
      /* l'ancienne copie reste visible dans un slot libre : rien de perdu */
    }
    void refreshScenes().catch(() => undefined);
    return ok(`Executor ${slot} renommé « ${label} »`);
  } catch (err) {
    return fail(`Renommage impossible : ${errorText(err)}`);
  }
}

/** Affecte une scène existante à un slot (null = détache). Une scène n'occupe qu'un slot. */
export function assignExecutor(slot: number, sceneId: string | null): void {
  if (!validSlot(slot, EXECUTOR_SLOTS)) return;
  playbackStore.set((prev) => {
    const execSlots: Record<number, string> = {};
    for (const [key, id] of Object.entries(prev.execSlots)) {
      if (Number(key) === slot) continue;
      if (sceneId !== null && id === sceneId) continue;
      execSlots[Number(key)] = id;
    }
    if (sceneId !== null) execSlots[slot] = sceneId;
    return { ...prev, execSlots };
  });
}

// ─── Groupes ────────────────────────────────────────────────────────────────

const selGroups = (s: PlaybackState) => s.groups;

export function useGroups(): Group[] {
  return useStore(playbackStore, selGroups);
}

export function groupAt(slot: number): Group | undefined {
  return playbackStore.get().groups.find((g) => g.slot === slot);
}

/** Mémorise la sélection courante (verrouillés exclus) dans un groupe. */
export function storeGroup(slot: number, name?: string): Result {
  if (!validSlot(slot, GROUP_SLOTS)) return fail(`Group ${slot} : hors pool (1-${GROUP_SLOTS})`);
  const byId = patchIndex(currentPatch());
  const ids = programmerStore.get().selection.filter((id) => {
    const f = byId.get(id);
    return f !== undefined && !f.locked;
  });
  if (!ids.length) return fail("Sélection vide — sélectionnez des projecteurs avant Store Group");
  const label = name?.trim() || `Group ${slot}`;
  const group: Group = { slot, name: label, fixtureIds: ids };
  playbackStore.set((prev) => ({
    ...prev,
    groups: [...prev.groups.filter((g) => g.slot !== slot), group].sort((a, b) => a.slot - b.slot)
  }));
  return ok(`Group ${slot} « ${label} » · ${ids.length} projecteur(s)`);
}

/** Rappelle un groupe dans la sélection (projecteurs disparus ou verrouillés ignorés). */
export function recallGroup(slot: number, mode: SelectMode = "replace"): Result {
  const group = groupAt(slot);
  if (!group) return fail(`Group ${slot} vide`);
  const byId = patchIndex(currentPatch());
  const alive = group.fixtureIds.filter((id) => {
    const f = byId.get(id);
    return f !== undefined && !f.locked;
  });
  if (!alive.length) return fail(`Group ${slot} « ${group.name} » : aucun projecteur encore pilotable`);
  select(alive, mode);
  return ok(`Group ${slot} « ${group.name} » · ${alive.length} projecteur(s)`);
}

export function deleteGroup(slot: number): void {
  playbackStore.set((prev) =>
    prev.groups.some((g) => g.slot === slot) ? { ...prev, groups: prev.groups.filter((g) => g.slot !== slot) } : prev
  );
}

export function labelGroup(slot: number, name: string): void {
  const label = name.trim();
  if (!label) return;
  playbackStore.set((prev) => ({
    ...prev,
    groups: prev.groups.map((g) => (g.slot === slot ? { ...g, name: label } : g))
  }));
}

// ─── Presets ────────────────────────────────────────────────────────────────

/**
 * Presets d'un pool, par slot (index 0 = slot 1). Les références explicites
 * d'abord ; les presets orphelins (sans référence dans aucun pool, créés ailleurs)
 * sont rangés dans les slots libres du pool All pour rester accessibles.
 */
export function resolvePresetPool(pool: PresetPool, presets: Preset[], refs: PresetRef[]): (Preset | null)[] {
  const slots: (Preset | null)[] = new Array<Preset | null>(PRESET_SLOTS).fill(null);
  const byId = new Map(presets.map((p) => [p.id, p]));
  for (const ref of refs) {
    if (ref.pool !== pool) continue;
    const preset = byId.get(ref.id);
    if (preset) slots[ref.slot - 1] = preset;
  }
  if (pool === "all") {
    const referenced = new Set(refs.map((r) => r.id));
    for (const preset of presets) {
      if (referenced.has(preset.id)) continue;
      const free = slots.indexOf(null);
      if (free < 0) break;
      slots[free] = preset;
    }
  }
  return slots;
}

/** Preset d'un pool/slot, lu sans abonnement. */
export function presetAt(pool: PresetPool, slot: number): Preset | null {
  if (!validSlot(slot, PRESET_SLOTS)) return null;
  return resolvePresetPool(pool, appStore.get().presets, playbackStore.get().presetRefs)[slot - 1] ?? null;
}

/** Pastille de couleur d'un preset : premier projecteur dont les trois canaux R/G/B sont dans le payload. */
export function presetSwatch(preset: Preset, patch: PatchedFixture[]): string | null {
  for (const f of patch) {
    const [r] = channelsFor(f, "r");
    const [g] = channelsFor(f, "g");
    const [b] = channelsFor(f, "b");
    if (!r || !g || !b) continue;
    const pr = preset.payload[String(r)];
    const pg = preset.payload[String(g)];
    const pb = preset.payload[String(b)];
    if (pr === undefined || pg === undefined || pb === undefined) continue;
    return `rgb(${pr}, ${pg}, ${pb})`;
  }
  return null;
}

/** Valeur % « représentative » d'un preset (tuile Dimmer) : max des canaux du payload. */
export function presetLevelPct(preset: Preset): number {
  const max = Object.values(preset.payload).reduce((m, v) => Math.max(m, v), 0);
  return Math.round((max / 255) * 100);
}

const selPresets = (s: AppState) => s.presets;
const selRefs = (s: PlaybackState) => s.presetRefs;

export type PresetTile = { slot: number; preset: Preset | null; swatch: string | null };

export function usePresetPool(pool: PresetPool): PresetTile[] {
  const presets = useStore(appStore, selPresets);
  const refs = useStore(playbackStore, selRefs);
  const patch = usePatch();
  return useMemo(
    () =>
      resolvePresetPool(pool, presets, refs).map((preset, i) => ({
        slot: i + 1,
        preset,
        swatch: preset ? presetSwatch(preset, patch) : null
      })),
    [pool, presets, refs, patch]
  );
}

// Un canal actif appartient-il au pool ? Pool "dimmer" : l'intensité, ou le RGB d'un
// projecteur SANS intensité (son dimmer, c'est son RGB — cf. lib/attributes).
const channelInPool = (fixture: PatchedFixture, channel: number, pool: PresetPool): boolean => {
  if (pool === "all") return true;
  const def = fixture.channels.find((c) => c.channel === channel - fixture.address + 1);
  const attr = def ? attrForCapability(def.capability) : null;
  if (!attr) return false;
  if (ATTRIBUTES[attr].group === pool) return true;
  if (pool === "dimmer" && (attr === "red" || attr === "green" || attr === "blue")) {
    return channelsFor(fixture, "intensity").length === 0;
  }
  return false;
};

/** STORE PRESET : canaux actifs du programmer appartenant au groupe du pool (pool "all" = tous). */
export async function storePreset(pool: PresetPool, slot: number, name?: string): Promise<Result> {
  if (!validSlot(slot, PRESET_SLOTS)) return fail(`${presetLabel(pool, slot)} : hors pool (1-${PRESET_SLOTS})`);
  const patch = currentPatch();
  const payload: Record<string, number> = {};
  for (const [key, value] of Object.entries(programmerStore.get().active)) {
    const channel = Number(key);
    const fixture = fixtureOf(patch, channel);
    if (!fixture || fixture.locked) continue;
    if (!channelInPool(fixture, channel, pool)) continue;
    payload[String(channel)] = value;
  }
  const count = Object.keys(payload).length;
  if (!count) {
    return fail(
      pool === "all"
        ? "Programmer vide — posez des valeurs avant Store Preset"
        : `Aucune valeur active du groupe ${POOL_LABELS[pool]} dans le programmer`
    );
  }
  const label = name?.trim() || `${POOL_LABELS[pool]} ${slot}`;
  try {
    const preset = await api.presets.create({ name: label, payload });
    upsertPreset(preset);
    playbackStore.set((prev) => ({
      ...prev,
      presetRefs: [...prev.presetRefs.filter((r) => !(r.pool === pool && r.slot === slot)), { id: preset.id, pool, slot }]
    }));
    void refreshPresets().catch(() => undefined);
    return ok(`${presetLabel(pool, slot)} « ${label} » · ${count} canaux`);
  } catch (err) {
    return fail(`Store Preset impossible : ${errorText(err)}`);
  }
}

/**
 * Applique un preset via le writer (programmer: true, garde appliquée). Si une
 * sélection existe, seuls les canaux des projecteurs sélectionnés sont écrits
 * (comportement MA3 : un preset s'applique à la sélection) ; sinon tout le payload.
 */
export async function applyPreset(pool: PresetPool, slot: number): Promise<Result> {
  const preset = presetAt(pool, slot);
  if (!preset) return fail(`${presetLabel(pool, slot)} vide`);
  const patch = currentPatch();
  const selection = new Set(programmerStore.get().selection);
  const entries: Array<[number, number]> = [];
  for (const [key, value] of Object.entries(preset.payload)) {
    const channel = Number(key);
    if (selection.size) {
      const owner = fixtureOf(patch, channel);
      if (!owner || !selection.has(owner.id)) continue;
    }
    entries.push([channel, value]);
  }
  if (!entries.length) return fail(`« ${preset.name} » : aucun canal de ce preset sur la sélection`);
  const written = writeChannels(entries, { programmer: true });
  if (!written) return fail(`« ${preset.name} » : tous les canaux sont verrouillés`);
  const refused = entries.length - written;
  return ok(`« ${preset.name} » · ${written} canaux${refused ? ` (${refused} verrouillé(s) ignoré(s))` : ""}`);
}

/** Pas de DELETE preset côté backend : retire la référence locale seulement. */
export async function deletePreset(pool: PresetPool, slot: number): Promise<Result> {
  const preset = presetAt(pool, slot);
  if (!preset) return fail(`${presetLabel(pool, slot)} déjà vide`);
  const hadRef = playbackStore.get().presetRefs.some((r) => r.pool === pool && r.slot === slot);
  if (!hadRef) {
    return fail(`« ${preset.name} » est un preset sans référence locale : il reste visible (pas de suppression côté backend)`);
  }
  playbackStore.set((prev) => ({
    ...prev,
    presetRefs: prev.presetRefs.filter((r) => !(r.pool === pool && r.slot === slot))
  }));
  return ok(`${presetLabel(pool, slot)} retiré du pool — le preset « ${preset.name} » reste enregistré côté backend`);
}
