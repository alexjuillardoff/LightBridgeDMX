import { describe, expect, it, vi } from "vitest";
import { createStore, shallowEqual } from "./store";

describe("store", () => {
  it("notifie à chaque changement, pas quand l'état est identique", () => {
    const store = createStore({ n: 1 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set({ n: 2 });
    store.set((prev) => prev);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().n).toBe(2);
    off();
    store.set({ n: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("shallowEqual compare tableaux et objets plats", () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [1, 3])).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(1, "1")).toBe(false);
  });
});
