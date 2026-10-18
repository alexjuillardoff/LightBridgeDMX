// Store applicatif : projecteurs, scènes, presets, lampes connectées, effets en
// cours, statut WebSocket et journal. Tout ce qui change RAREMENT — l'univers
// DMX (30 Hz) vit à part dans state/universe.ts.
import type { Fixture, Preset, RunningEffect, Scene, SmartLight } from "@lightbridgedmx/shared";
import { api } from "../lib/api";
import { createStore, useStore } from "../lib/store";

export type LogEntry = { level: "info" | "warn" | "error"; message: string; timestamp: string };
export type WsStatus = "connecting" | "open" | "closed";

export type AppState = {
  fixtures: Fixture[];
  scenes: Scene[];
  presets: Preset[];
  smartLights: SmartLight[];
  running: RunningEffect[];
  wsStatus: WsStatus;
  /** Journal, le plus récent EN PREMIER (200 entrées au plus). */
  logs: LogEntry[];
  /** Entrées non lues depuis la dernière ouverture du Message Center. */
  unread: number;
  /** true après le premier refreshAll() abouti (même partiellement). */
  loaded: boolean;
  /** Dernière erreur de chargement, ou null. */
  error: string | null;
};

export const LOG_LIMIT = 200;

export const appStore = createStore<AppState>({
  fixtures: [],
  scenes: [],
  presets: [],
  smartLights: [],
  running: [],
  wsStatus: "connecting",
  logs: [],
  unread: 0,
  loaded: false,
  error: null
});

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Recharge tout : projecteurs, scènes, presets, lampes, effets. Une requête en échec
 *  n'empêche pas les autres de s'appliquer ; l'erreur est journalisée. */
export async function refreshAll(): Promise<void> {
  const [fixtures, scenes, presets, smartLights, effects] = await Promise.allSettled([
    api.fixtures.list(),
    api.scenes.list(),
    api.presets.list(),
    api.smartLights.list(),
    api.effects.list()
  ]);

  const errors: string[] = [];
  appStore.set((prev) => {
    const next = { ...prev, loaded: true };
    if (fixtures.status === "fulfilled") next.fixtures = fixtures.value;
    else errors.push(`projecteurs : ${message(fixtures.reason)}`);
    if (scenes.status === "fulfilled") next.scenes = scenes.value;
    else errors.push(`scènes : ${message(scenes.reason)}`);
    if (presets.status === "fulfilled") next.presets = presets.value;
    else errors.push(`presets : ${message(presets.reason)}`);
    if (smartLights.status === "fulfilled") next.smartLights = smartLights.value;
    else errors.push(`lampes : ${message(smartLights.reason)}`);
    if (effects.status === "fulfilled") next.running = effects.value.running;
    else errors.push(`effets : ${message(effects.reason)}`);
    next.error = errors.length ? `Chargement incomplet — ${errors.join(" · ")}` : null;
    return next;
  });

  if (errors.length) {
    pushLog({ level: "error", message: `Chargement incomplet — ${errors.join(" · ")}`, timestamp: new Date().toISOString() });
  }
}

export async function refreshScenes(): Promise<void> {
  const scenes = await api.scenes.list();
  appStore.set((prev) => ({ ...prev, scenes }));
}

export async function refreshPresets(): Promise<void> {
  const presets = await api.presets.list();
  appStore.set((prev) => ({ ...prev, presets }));
}

export async function refreshFixtures(): Promise<void> {
  const fixtures = await api.fixtures.list();
  appStore.set((prev) => ({ ...prev, fixtures }));
}

export async function refreshSmartLights(): Promise<void> {
  const smartLights = await api.smartLights.list();
  appStore.set((prev) => ({ ...prev, smartLights }));
}

export async function refreshEffects(): Promise<void> {
  const { running } = await api.effects.list();
  appStore.set((prev) => ({ ...prev, running }));
}

/** Ajoute une entrée au journal (le plus récent en premier, 200 max) et incrémente `unread`. */
export function pushLog(entry: LogEntry): void {
  appStore.set((prev) => ({
    ...prev,
    logs: [entry, ...prev.logs].slice(0, LOG_LIMIT),
    unread: prev.unread + 1
  }));
}

/** Raccourci : journalise un message daté de maintenant. */
export function log(level: LogEntry["level"], text: string): void {
  pushLog({ level, message: text, timestamp: new Date().toISOString() });
}

export function markLogsRead(): void {
  appStore.set((prev) => (prev.unread === 0 ? prev : { ...prev, unread: 0 }));
}

export function setWsStatus(status: WsStatus): void {
  appStore.set((prev) => (prev.wsStatus === status ? prev : { ...prev, wsStatus: status }));
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx < 0) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
};

export function upsertFixture(f: Fixture): void {
  appStore.set((prev) => ({ ...prev, fixtures: upsert(prev.fixtures, f) }));
}

export function removeFixture(id: string): void {
  appStore.set((prev) => ({ ...prev, fixtures: prev.fixtures.filter((f) => f.id !== id) }));
}

export function upsertSmartLight(l: SmartLight): void {
  appStore.set((prev) => ({ ...prev, smartLights: upsert(prev.smartLights, l) }));
}

export function upsertScene(s: Scene): void {
  appStore.set((prev) => ({ ...prev, scenes: upsert(prev.scenes, s) }));
}

export function removeScene(id: string): void {
  appStore.set((prev) => ({ ...prev, scenes: prev.scenes.filter((s) => s.id !== id) }));
}

export function upsertPreset(p: Preset): void {
  appStore.set((prev) => ({ ...prev, presets: upsert(prev.presets, p) }));
}

export function setRunning(r: RunningEffect[]): void {
  appStore.set((prev) => ({ ...prev, running: r }));
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
const selWs = (s: AppState) => s.wsStatus;
const selLogs = (s: AppState) => s.logs;
const selUnread = (s: AppState) => s.unread;
const selFixtures = (s: AppState) => s.fixtures;
const selScenes = (s: AppState) => s.scenes;
const selPresets = (s: AppState) => s.presets;
const selLights = (s: AppState) => s.smartLights;
const selRunning = (s: AppState) => s.running;
const selLoaded = (s: AppState) => s.loaded;
const selError = (s: AppState) => s.error;

export function useWsStatus(): WsStatus {
  return useStore(appStore, selWs);
}
export function useLogs(): LogEntry[] {
  return useStore(appStore, selLogs);
}
export function useUnread(): number {
  return useStore(appStore, selUnread);
}
export function useFixtures(): Fixture[] {
  return useStore(appStore, selFixtures);
}
export function useScenes(): Scene[] {
  return useStore(appStore, selScenes);
}
export function usePresets(): Preset[] {
  return useStore(appStore, selPresets);
}
export function useSmartLights(): SmartLight[] {
  return useStore(appStore, selLights);
}
export function useRunningEffects(): RunningEffect[] {
  return useStore(appStore, selRunning);
}
export function useAppLoaded(): boolean {
  return useStore(appStore, selLoaded);
}
export function useAppError(): string | null {
  return useStore(appStore, selError);
}

/** Efface le bandeau d'erreur (le prochain refreshAll le remettra si besoin). */
export function clearAppError(): void {
  appStore.set((prev) => (prev.error === null ? prev : { ...prev, error: null }));
}
