// File de messages éphémères (toasts) : chaque message reste 4 s, en bas de l'écran
// au-dessus de l'encoder bar. Tout le monde peut appeler `toast()` (fenêtres comprises).
import { createStore, useStore } from "../lib/store";

export type ToastKind = "info" | "ok" | "error" | "warn";
export type Toast = { id: number; message: string; kind: ToastKind };

const TOAST_MS = 4000;
let nextId = 1;

export const toastStore = createStore<{ items: Toast[] }>({ items: [] });

/** Affiche un message pendant 4 s. */
export function toast(message: string, kind: ToastKind = "info"): void {
  const id = nextId++;
  toastStore.set((prev) => ({ items: [...prev.items.slice(-4), { id, message, kind }] }));
  window.setTimeout(() => {
    toastStore.set((prev) => ({ items: prev.items.filter((t) => t.id !== id) }));
  }, TOAST_MS);
}

export function Toasts() {
  const items = useStore(toastStore, (s) => s.items);
  if (items.length === 0) return null;
  return (
    <div className="ma-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`ma-toast ma-toast--${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
