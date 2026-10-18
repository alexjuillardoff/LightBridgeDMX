// État du bouton « ShCuts » (raccourcis clavier globaux actifs ou non), persisté dans
// localStorage (clé lb3.shcuts). Module séparé pour éviter un cycle d'imports entre
// CommandLine.tsx et useKeyboardShortcuts.ts.
import { readLocal, writeLocal } from "../lib/local-store";
import { createStore, useStore } from "../lib/store";

const KEY = "shcuts";

export const shortcutsStore = createStore<{ enabled: boolean }>({ enabled: readLocal<boolean>(KEY, true) === true });

export function useShortcutsEnabled(): boolean {
  return useStore(shortcutsStore, (s) => s.enabled);
}

export function toggleShortcuts(): void {
  shortcutsStore.set((s) => ({ enabled: !s.enabled }));
  writeLocal(KEY, shortcutsStore.get().enabled);
}
