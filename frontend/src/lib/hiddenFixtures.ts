// Projecteurs masques cote front.
//
// Filtre purement cosmetique : les projecteurs listes ici restent en base, dans
// les scenes et dans HomeKit, et le backend continue de les piloter. On les
// retire seulement des listes affichees (fiche projecteurs, encodeurs, moniteur
// d'univers, inventaire Appareils, panneau Dance...).
//
// Pour reafficher un projecteur, retire son id de cette liste.
const HIDDEN_FIXTURE_IDS = new Set<string>([
  "ed9ad662-f62d-4320-b1cc-2d4ca27b2e85" // Par 56 Bureau (U0, ch. 100-107)
]);

/** true si ce projecteur ne doit pas apparaitre dans l'UI. */
export const isHiddenFixture = (id: string): boolean => HIDDEN_FIXTURE_IDS.has(id);

/** Retire les projecteurs masques d'une liste (fixtures, ou entrees d'inventaire). */
export const withoutHiddenFixtures = <T extends { id: string }>(items: T[]): T[] =>
  HIDDEN_FIXTURE_IDS.size === 0 ? items : items.filter((item) => !HIDDEN_FIXTURE_IDS.has(item.id));
