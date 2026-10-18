// Espace de travail : vues (7 boutons de la view bar), fenêtres de l'écran
// (grille 24×16), barres visibles, overlay ouvert, échelle de l'interface.
//
// Le contenu de l'écran EST la vue courante : déplacer ou fermer une fenêtre
// modifie `views[current]` en place. « Store View » photographie ce contenu
// dans un autre bouton. Persisté dans lb3.views (vues + vue courante) et
// lb3.ui (barres + échelle). Ce module peut toucher window/localStorage, mais
// toujours derrière une garde : il doit se charger sous Node (tests).
import { readLocal, writeLocal } from "../lib/local-store";
import { createStore, useStore } from "../lib/store";

export type WindowKind =
  | "fixtureSheet"
  | "layout"
  | "groups"
  | "presets"
  | "executors"
  | "phaser"
  | "dmxSheet"
  | "patch"
  | "devices"
  | "setup"
  | "help"
  | "colorPicker";

export const WINDOW_KINDS: WindowKind[] = [
  "fixtureSheet",
  "layout",
  "groups",
  "presets",
  "executors",
  "phaser",
  "dmxSheet",
  "patch",
  "devices",
  "setup",
  "help",
  "colorPicker"
];

export type WindowInstance = {
  id: string;
  kind: WindowKind;
  x: number;
  y: number;
  w: number;
  h: number;
  settings?: Record<string, unknown>;
};
export type View = { name: string; windows: WindowInstance[] };
export const GRID_COLS = 24;
export const GRID_ROWS = 16;
export const VIEW_COUNT = 7;

export type Overlay =
  | "none"
  | "shutdown"
  | "menu"
  | "commandSection"
  | "masterControls"
  | "specialMasters"
  | "playbackControls"
  | "displays"
  | "at"
  | "messages"
  | "cmdHistory"
  | "addWindow"
  | "calculator"
  | "storeView";

export type WorkspaceState = {
  /** 7 entrées (null = bouton vide). */
  views: (View | null)[];
  /** Index de la vue affichée (0..6). */
  current: number;
  showControlBar: boolean;
  showViewBar: boolean;
  showEncoderBar: boolean;
  /** Encoder bar remplacée par la command wing bar (10 executors). */
  wingBar: boolean;
  overlay: Overlay;
  overlayPayload?: unknown;
  /** 1 = 1920 px de large ; auto au chargement (clamp 0.55..1.25) si rien de persisté. */
  uiScale: number;
};

/** Taille par défaut d'une fenêtre par type (en cellules de grille) : REPLI pour les
 *  appels qui ne connaissent pas le registre (ligne de commande). Le chrome passe la
 *  defaultSize du module via windows/registry.openWindow() ; garder les deux alignés. */
export const DEFAULT_WINDOW_SIZES: Record<WindowKind, { w: number; h: number }> = {
  fixtureSheet: { w: 24, h: 8 },
  layout: { w: 12, h: 8 },
  groups: { w: 8, h: 7 },
  presets: { w: 8, h: 7 },
  executors: { w: 12, h: 7 },
  phaser: { w: 14, h: 10 },
  dmxSheet: { w: 24, h: 8 },
  patch: { w: 16, h: 12 },
  devices: { w: 8, h: 12 },
  setup: { w: 12, h: 12 },
  help: { w: 12, h: 12 },
  colorPicker: { w: 8, h: 8 }
};
export const MIN_WINDOW_SIZE = { w: 3, h: 2 };
export const UI_SCALE_AUTO_RANGE = { min: 0.55, max: 1.25 };
export const UI_SCALE_MANUAL_RANGE = { min: 0.4, max: 1.6 };

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

let counter = 0;
const newId = (kind: WindowKind): string => {
  counter += 1;
  return `w-${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
};

const win = (id: string, kind: WindowKind, x: number, y: number, w: number, h: number, settings?: Record<string, unknown>): WindowInstance =>
  settings ? { id, kind, x, y, w, h, settings } : { id, kind, x, y, w, h };

/** Vues par défaut (§5.2). */
export const DEFAULT_VIEWS: (View | null)[] = [
  {
    name: "Live",
    windows: [
      win("v1-fixtureSheet", "fixtureSheet", 0, 0, 24, 9),
      win("v1-groups", "groups", 0, 9, 8, 7),
      win("v1-presets", "presets", 8, 9, 8, 7, { pool: "color" }),
      win("v1-executors", "executors", 16, 9, 8, 7)
    ]
  },
  { name: "Playback", windows: [win("v2-executors", "executors", 0, 0, 12, 16), win("v2-layout", "layout", 12, 0, 12, 16)] },
  { name: "Phaser", windows: [win("v3-phaser", "phaser", 0, 0, 14, 16), win("v3-fixtureSheet", "fixtureSheet", 14, 0, 10, 16)] },
  { name: "Patch", windows: [win("v4-patch", "patch", 0, 0, 16, 16), win("v4-devices", "devices", 16, 0, 8, 16)] },
  { name: "DMX", windows: [win("v5-dmxSheet", "dmxSheet", 0, 0, 24, 16)] },
  { name: "Setup", windows: [win("v6-setup", "setup", 0, 0, 12, 16), win("v6-help", "help", 12, 0, 12, 16)] },
  null
];

// Copie profonde des vues par défaut (les objets du store ne doivent pas être partagés avec la constante).
const cloneViews = (views: (View | null)[]): (View | null)[] =>
  views.map((v) => (v ? { name: v.name, windows: v.windows.map((w) => ({ ...w, settings: w.settings ? { ...w.settings } : undefined })) } : null));

// ─── Chargement défensif ────────────────────────────────────────────────────

const isWindow = (w: unknown): w is WindowInstance => {
  if (typeof w !== "object" || w === null) return false;
  const o = w as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.kind === "string" &&
    (WINDOW_KINDS as string[]).includes(o.kind) &&
    [o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (o.settings === undefined || (typeof o.settings === "object" && o.settings !== null))
  );
};

const isView = (v: unknown): v is View =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as View).name === "string" &&
  Array.isArray((v as View).windows) &&
  (v as View).windows.every(isWindow);

type PersistedViews = { views: (View | null)[]; current: number };
const loadViews = (): PersistedViews | null => {
  const raw = readLocal<unknown>("views", null);
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Partial<PersistedViews>;
  if (!Array.isArray(o.views) || o.views.length !== VIEW_COUNT) return null;
  if (!o.views.every((v) => v === null || isView(v))) return null;
  const current = typeof o.current === "number" ? clamp(Math.floor(o.current), 0, VIEW_COUNT - 1) : 0;
  return { views: o.views as (View | null)[], current };
};

type UiPrefs = Partial<Pick<WorkspaceState, "showControlBar" | "showViewBar" | "showEncoderBar" | "wingBar" | "uiScale">>;
const loadUi = (): UiPrefs => {
  const raw = readLocal<unknown>("ui", null);
  if (typeof raw !== "object" || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const bool = (key: string): boolean | undefined => (typeof o[key] === "boolean" ? (o[key] as boolean) : undefined);
  const scale = typeof o.uiScale === "number" && Number.isFinite(o.uiScale) ? o.uiScale : undefined;
  return {
    showControlBar: bool("showControlBar"),
    showViewBar: bool("showViewBar"),
    showEncoderBar: bool("showEncoderBar"),
    wingBar: bool("wingBar"),
    uiScale: scale === undefined ? undefined : clamp(scale, UI_SCALE_MANUAL_RANGE.min, UI_SCALE_MANUAL_RANGE.max)
  };
};

const hasWindow = typeof window !== "undefined";
const viewportWidth = (): number => (hasWindow ? window.innerWidth || 1920 : 1920);

/** Échelle automatique : clamp(0.55, largeur / 1920, 1.25). */
export const autoUiScale = (): number => clamp(viewportWidth() / 1920, UI_SCALE_AUTO_RANGE.min, UI_SCALE_AUTO_RANGE.max);

const initialState = (): WorkspaceState => {
  const persisted = loadViews();
  const ui = loadUi();
  // Sous 900 px de large, control bar et view bar sont masquées par défaut (ré-affichables par ◀ ▶).
  const narrow = viewportWidth() < 900;
  return {
    views: persisted ? persisted.views : cloneViews(DEFAULT_VIEWS),
    current: persisted ? persisted.current : 0,
    showControlBar: ui.showControlBar ?? !narrow,
    showViewBar: ui.showViewBar ?? !narrow,
    showEncoderBar: ui.showEncoderBar ?? true,
    wingBar: ui.wingBar ?? false,
    overlay: "none",
    uiScale: ui.uiScale ?? autoUiScale()
  };
};

export const workspaceStore = createStore<WorkspaceState>(initialState());

// Persistance : vues + vue courante d'un côté, préférences d'interface de l'autre.
let persisted = workspaceStore.get();
workspaceStore.subscribe(() => {
  const s = workspaceStore.get();
  if (s.views !== persisted.views || s.current !== persisted.current) {
    writeLocal("views", { views: s.views, current: s.current });
  }
  if (
    s.showControlBar !== persisted.showControlBar ||
    s.showViewBar !== persisted.showViewBar ||
    s.showEncoderBar !== persisted.showEncoderBar ||
    s.wingBar !== persisted.wingBar ||
    s.uiScale !== persisted.uiScale
  ) {
    writeLocal("ui", {
      showControlBar: s.showControlBar,
      showViewBar: s.showViewBar,
      showEncoderBar: s.showEncoderBar,
      wingBar: s.wingBar,
      uiScale: s.uiScale
    });
  }
  persisted = s;
});

export function useWorkspace<S>(selector: (s: WorkspaceState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(workspaceStore, selector, equal);
}

const selCurrentView = (s: WorkspaceState): View | null => s.views[s.current] ?? null;
const EMPTY_WINDOWS: WindowInstance[] = [];
const selWindows = (s: WorkspaceState): WindowInstance[] => s.views[s.current]?.windows ?? EMPTY_WINDOWS;
const selOverlay = (s: WorkspaceState): Overlay => s.overlay;

export function useCurrentView(): View | null {
  return useStore(workspaceStore, selCurrentView);
}
export function useWindows(): WindowInstance[] {
  return useStore(workspaceStore, selWindows);
}
export function useOverlay(): Overlay {
  return useStore(workspaceStore, selOverlay);
}

// ─── Vues ───────────────────────────────────────────────────────────────────

export function showView(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= VIEW_COUNT) return;
  workspaceStore.set((prev) => (prev.current === index && prev.overlay === "none" ? prev : { ...prev, current: index, overlay: "none" }));
}

/** Photographie les fenêtres courantes dans le bouton `index` sous le nom donné. */
export function storeView(index: number, name: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= VIEW_COUNT) return;
  workspaceStore.set((prev) => {
    const windows = (prev.views[prev.current]?.windows ?? []).map((w) => ({ ...w, settings: w.settings ? { ...w.settings } : undefined }));
    const views = prev.views.slice();
    views[index] = { name: name.trim() || `View ${index + 1}`, windows };
    return { ...prev, views };
  });
}

export function deleteView(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= VIEW_COUNT) return;
  workspaceStore.set((prev) => {
    if (prev.views[index] === null) return prev;
    const views = prev.views.slice();
    views[index] = null;
    return { ...prev, views };
  });
}

/** Restaure les vues par défaut (Setup → reset). */
export function resetViews(): void {
  workspaceStore.set((prev) => ({ ...prev, views: cloneViews(DEFAULT_VIEWS), current: 0, overlay: "none" }));
}

// ─── Fenêtres ───────────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Borne une fenêtre dans la grille : taille d'abord, position ensuite.
const clampRect = (r: Rect): Rect => {
  const w = clamp(Math.round(r.w), MIN_WINDOW_SIZE.w, GRID_COLS);
  const h = clamp(Math.round(r.h), MIN_WINDOW_SIZE.h, GRID_ROWS);
  const x = clamp(Math.round(r.x), 0, GRID_COLS - w);
  const y = clamp(Math.round(r.y), 0, GRID_ROWS - h);
  return { x, y, w, h };
};

/** Première zone libre (balayage ligne par ligne) pour une taille donnée, ou null. */
export function findFreeSpot(windows: Rect[], size: { w: number; h: number }): { x: number; y: number } | null {
  const w = clamp(size.w, MIN_WINDOW_SIZE.w, GRID_COLS);
  const h = clamp(size.h, MIN_WINDOW_SIZE.h, GRID_ROWS);
  for (let y = 0; y + h <= GRID_ROWS; y += 1) {
    for (let x = 0; x + w <= GRID_COLS; x += 1) {
      const candidate = { x, y, w, h };
      if (!windows.some((other) => overlaps(candidate, other))) return { x, y };
    }
  }
  return null;
}

/** Fenêtres de la vue courante (sans abonnement). */
export function currentWindows(): WindowInstance[] {
  const s = workspaceStore.get();
  return s.views[s.current]?.windows ?? EMPTY_WINDOWS;
}

/** Première fenêtre d'un type dans la vue courante, ou undefined. */
export function findWindow(kind: WindowKind): WindowInstance | undefined {
  return currentWindows().find((w) => w.kind === kind);
}

/**
 * Ajoute une fenêtre dans la vue courante (une vue vide est créée au besoin).
 * Sans `at` : première zone libre, sinon en (0,0) par-dessus. `size` = taille du
 * module (sinon DEFAULT_WINDOW_SIZES). Renvoie l'id de la fenêtre créée.
 */
export function addWindow(
  kind: WindowKind,
  at?: { x: number; y: number },
  size?: { w: number; h: number },
  settings?: Record<string, unknown>
): string {
  const id = newId(kind);
  const wanted = size ?? DEFAULT_WINDOW_SIZES[kind];
  workspaceStore.set((prev) => {
    const view = prev.views[prev.current] ?? { name: `View ${prev.current + 1}`, windows: [] };
    let rect: Rect;
    if (at) {
      rect = clampRect({ x: at.x, y: at.y, w: wanted.w, h: wanted.h });
    } else {
      const spot = findFreeSpot(view.windows, wanted);
      rect = spot ? clampRect({ ...spot, w: wanted.w, h: wanted.h }) : clampRect({ x: 0, y: 0, w: wanted.w, h: wanted.h });
    }
    const created: WindowInstance = settings ? { id, kind, ...rect, settings } : { id, kind, ...rect };
    const views = prev.views.slice();
    views[prev.current] = { ...view, windows: [...view.windows, created] };
    return { ...prev, views, overlay: prev.overlay === "addWindow" ? "none" : prev.overlay };
  });
  return id;
}

const updateCurrentWindows = (fn: (windows: WindowInstance[]) => WindowInstance[]): void => {
  workspaceStore.set((prev) => {
    const view = prev.views[prev.current];
    if (!view) return prev;
    const windows = fn(view.windows);
    if (windows === view.windows) return prev;
    const views = prev.views.slice();
    views[prev.current] = { ...view, windows };
    return { ...prev, views };
  });
};

/** Modifie une fenêtre (position/taille bornées dans la grille ; `settings` remplace). */
export function updateWindow(id: string, patch: Partial<WindowInstance>): void {
  updateCurrentWindows((windows) => {
    const idx = windows.findIndex((w) => w.id === id);
    if (idx < 0) return windows;
    const current = windows[idx];
    const rect = clampRect({
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      w: patch.w ?? current.w,
      h: patch.h ?? current.h
    });
    const next: WindowInstance = { ...current, ...rect };
    if (patch.settings !== undefined) next.settings = patch.settings;
    if (patch.kind !== undefined) next.kind = patch.kind;
    const copy = windows.slice();
    copy[idx] = next;
    return copy;
  });
}

/** Fusionne des réglages dans `settings` (ce que WindowProps.setSettings appelle). */
export function setWindowSettings(id: string, patch: Record<string, unknown>): void {
  updateCurrentWindows((windows) => {
    const idx = windows.findIndex((w) => w.id === id);
    if (idx < 0) return windows;
    const copy = windows.slice();
    copy[idx] = { ...windows[idx], settings: { ...(windows[idx].settings ?? {}), ...patch } };
    return copy;
  });
}

export function removeWindow(id: string): void {
  updateCurrentWindows((windows) => (windows.some((w) => w.id === id) ? windows.filter((w) => w.id !== id) : windows));
}

/** Passe une fenêtre au premier plan (z-order = ordre du tableau). */
export function raiseWindow(id: string): void {
  updateCurrentWindows((windows) => {
    const idx = windows.findIndex((w) => w.id === id);
    if (idx < 0 || idx === windows.length - 1) return windows;
    return [...windows.slice(0, idx), ...windows.slice(idx + 1), windows[idx]];
  });
}

// ─── Overlays et barres ─────────────────────────────────────────────────────

export function openOverlay(o: Overlay, payload?: unknown): void {
  workspaceStore.set((prev) => ({ ...prev, overlay: o, overlayPayload: payload }));
}

export function closeOverlay(): void {
  workspaceStore.set((prev) => (prev.overlay === "none" ? prev : { ...prev, overlay: "none", overlayPayload: undefined }));
}

/** Ouvre l'overlay, ou le ferme s'il est déjà ouvert (boutons à bascule de la control bar). */
export function toggleOverlay(o: Overlay, payload?: unknown): void {
  if (workspaceStore.get().overlay === o) closeOverlay();
  else openOverlay(o, payload);
}

export function toggleBar(bar: "control" | "view" | "encoder" | "wing"): void {
  workspaceStore.set((prev) => {
    switch (bar) {
      case "control":
        return { ...prev, showControlBar: !prev.showControlBar };
      case "view":
        return { ...prev, showViewBar: !prev.showViewBar };
      case "encoder":
        return { ...prev, showEncoderBar: !prev.showEncoderBar };
      case "wing":
        return { ...prev, wingBar: !prev.wingBar };
      default:
        return prev;
    }
  });
}

export function setUiScale(scale: number): void {
  if (!Number.isFinite(scale)) return;
  const next = Math.round(clamp(scale, UI_SCALE_MANUAL_RANGE.min, UI_SCALE_MANUAL_RANGE.max) * 100) / 100;
  workspaceStore.set((prev) => (prev.uiScale === next ? prev : { ...prev, uiScale: next }));
}
