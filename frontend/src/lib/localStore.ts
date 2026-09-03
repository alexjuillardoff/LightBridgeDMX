// Petit utilitaire de persistance locale (localStorage), typé et tolérant.
//
// Ce qui vit ici est ce qui est PROPRE AU POSTE, pas au spectacle : disposition
// des fenêtres du pupitre, groupes de sélection, affectation des executors aux
// emplacements. Les scènes et les presets, eux, sont persistés côté backend.
//
// Toutes les lectures sont défensives : un localStorage indisponible (navigation
// privée, quota plein, JSON corrompu par une version précédente) ne doit jamais
// empêcher le pupitre de s'afficher — on retombe simplement sur la valeur par
// défaut.

// Préfixe commun, pour ne pas marcher sur les clés d'une autre app du domaine.
const PREFIX = "lightbridge.console.";

/** Lit une valeur persistée. Renvoie `fallback` si absente, illisible ou refusée. */
export const readLocal = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Écrit une valeur persistée. Un échec (quota, mode privé) est ignoré en silence. */
export const writeLocal = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le pupitre marche quand même, sans mémoire */
  }
};

/** Supprime une valeur persistée (retour aux réglages d'usine d'un bloc). */
export const clearLocal = (key: string): void => {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* idem */
  }
};
