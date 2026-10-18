// Persistance locale (localStorage), typée et tolérante. Préfixe `lb3.`.
//
// Ce qui vit ici est PROPRE AU POSTE, pas au spectacle : vues et fenêtres,
// groupes de sélection, affectation des executors et des presets aux slots,
// historique de la ligne de commande, échelle de l'interface. Les scènes et les
// presets eux-mêmes sont persistés côté backend.
//
// Toutes les lectures sont défensives : un localStorage indisponible (navigation
// privée, quota plein, JSON corrompu, exécution sous Node pour les tests) ne doit
// jamais empêcher le pupitre de s'afficher — on retombe sur la valeur par défaut.

const PREFIX = "lb3.";

/** Clés connues, pour l'export/import de sauvegarde et la remise à zéro. */
export const LOCAL_KEYS = ["execSlots", "groups", "presetRefs", "layout", "views", "ui", "history"] as const;
/** Clé connue ou libre (une clé libre est acceptée : les fenêtres peuvent ranger un réglage propre). */
export type LocalKey = string;
export type KnownLocalKey = (typeof LOCAL_KEYS)[number];

// Accès au stockage, ou null s'il n'existe pas (Node) ou s'il refuse (mode privé).
const storage = (): Storage | null => {
  try {
    // Sous Node (tests), pas de fenêtre : on n'effleure même pas le localStorage
    // expérimental de Node 22+, qui avertit dès qu'on le lit.
    if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
};

/** Lit une valeur persistée. Renvoie `fallback` si absente, illisible ou refusée. */
export const readLocal = <T>(key: LocalKey, fallback: T): T => {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Écrit une valeur persistée. Un échec (quota, mode privé, Node) est ignoré en silence. */
export const writeLocal = (key: LocalKey, value: unknown): void => {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le pupitre marche quand même, sans mémoire */
  }
};

/** Supprime une valeur persistée (retour aux réglages d'usine d'un bloc). */
export const clearLocal = (key: LocalKey): void => {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* idem */
  }
};

/** Efface toutes les clés connues (bouton « reset » des réglages). */
export const clearAllLocal = (): void => {
  LOCAL_KEYS.forEach(clearLocal);
};

/** Photographie toutes les clés connues (export de sauvegarde JSON). */
export const exportLocal = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  LOCAL_KEYS.forEach((key) => {
    const value = readLocal<unknown>(key, undefined);
    if (value !== undefined) out[key] = value;
  });
  return out;
};

/** Restaure une sauvegarde : seules les clés connues sont prises. Renvoie le nombre de clés écrites. */
export const importLocal = (data: Record<string, unknown>): number => {
  let count = 0;
  LOCAL_KEYS.forEach((key) => {
    if (key in data && data[key] !== undefined) {
      writeLocal(key, data[key]);
      count += 1;
    }
  });
  return count;
};
