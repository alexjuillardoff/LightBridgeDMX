// Store externe minimal + hook d'abonnement sélectif (useSyncExternalStore, React 18).
//
// Pourquoi pas un contexte React : l'univers DMX arrive à 30 Hz et un contexte
// re-rendrait tout l'arbre à chaque tick. Ici chaque composant s'abonne à UNE
// sélection de l'état (un canal, une liste d'ids…) et ne se réveille que si
// cette sélection change. Les stores vivent au niveau module : pas de Provider,
// pas de prop drilling, et la logique métier (writer, programmer, playback) peut
// les lire et les écrire hors de React.
import { useCallback, useRef, useSyncExternalStore } from "react";

export type Store<T> = {
  get(): T;
  /** Remplace l'état (immutable) et notifie les abonnés. Un état identique (Object.is) ne notifie pas. */
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      // Un abonné qui lève ne doit pas priver les autres de la notification.
      for (const listener of listeners) {
        try {
          listener();
        } catch (err) {
          console.error("[store] abonné en erreur", err);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

// Mémo d'une sélection : l'état d'où elle vient, le sélecteur qui l'a produite et
// son résultat. useSyncExternalStore exige que getSnapshot renvoie une valeur
// stable tant que rien n'a changé, sinon React boucle ; c'est ce mémo qui le garantit.
type SelectionMemo<T, S> = { state: T; selector: (s: T) => S; selected: S };

/**
 * Abonnement sélectif : ne re-rend que si `selector(state)` change (Object.is,
 * ou `equal` pour un résultat composé — voir shallowEqual).
 *
 * Le sélecteur peut être une fonction fléchée inline : s'il change d'identité à
 * chaque rendu on recalcule la sélection, mais on conserve l'ancienne référence
 * quand `equal` la juge identique, ce qui évite tout re-rendu inutile.
 */
export function useStore<T, S>(
  store: Store<T>,
  selector: (s: T) => S,
  equal: (a: S, b: S) => boolean = Object.is
): S {
  const memo = useRef<SelectionMemo<T, S> | null>(null);
  const equalRef = useRef(equal);
  equalRef.current = equal;

  const getSnapshot = useCallback((): S => {
    const state = store.get();
    const prev = memo.current;
    if (prev !== null && prev.state === state && prev.selector === selector) return prev.selected;
    const next = selector(state);
    if (prev !== null && equalRef.current(prev.selected, next)) {
      memo.current = { state, selector, selected: prev.selected };
      return prev.selected;
    }
    memo.current = { state, selector, selected: next };
    return next;
  }, [store, selector]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Égalité superficielle : tableaux (élément par élément) et objets plats (clé par clé). */
export const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) return false;
  }
  return true;
};
