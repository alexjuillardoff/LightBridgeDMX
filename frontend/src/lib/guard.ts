// Garde-fou de sécurité : projecteurs verrouillés (la chambre).
//
// Certains projecteurs ne doivent JAMAIS être allumés depuis le pupitre (le PAR,
// le plafonnier ou la prise de la chambre, quand quelqu'un y dort). Les masquer
// serait un mauvais garde-fou : un projecteur invisible finit par être rallumé
// « par accident » depuis la ligne de commande ou une scène rappelée.
//
// On les laisse donc VISIBLES mais VERROUILLÉS : cadenas dans les sheets, jamais
// sélectionnables, jamais écrits (le dmx-writer refuse leurs canaux — point de
// passage unique), exclus des scènes, presets, groupes et phasers.
//
// Règle : liste blanche. Un projecteur dont la pièce est la chambre, dont le nom
// évoque la chambre, ou dont l'id figure dans la liste nominative, est verrouillé
// tant qu'on ne l'a pas explicitement autorisé en le retirant d'ici.

/** Forme minimale exigée : tout ce que la garde a besoin de lire. */
export type Guardable = { id: string; name: string; room?: string | null };

/** Pièces dont tous les projecteurs sont verrouillés (comparaison insensible à la casse). */
export const LOCKED_ROOMS: ReadonlySet<string> = new Set(["chambre", "bedroom"]);

/** Un nom qui évoque la chambre suffit à verrouiller, même sans pièce renseignée :
 *  un projecteur mal rangé ne doit pas passer entre les mailles. */
export const LOCKED_NAME_PATTERN = /\bchambre\b|\bbedroom\b/i;

/** Verrous nominatifs, par id. À remplir quand un projecteur doit être bloqué
 *  sans que son nom ni sa pièce ne le trahissent. */
export const LOCKED_FIXTURE_IDS: ReadonlySet<string> = new Set<string>([]);

/** Raison du verrou, ou null si le projecteur est pilotable. */
export const lockReason = (fixture: Guardable): string | null => {
  if (LOCKED_FIXTURE_IDS.has(fixture.id)) return "Verrouillé manuellement";
  const room = fixture.room?.trim().toLowerCase();
  if (room && LOCKED_ROOMS.has(room)) return `Pièce protégée : ${fixture.room}`;
  if (LOCKED_NAME_PATTERN.test(fixture.name)) return "Projecteur de chambre";
  return null;
};

/** true si ce projecteur ne doit être allumé sous aucun prétexte. */
export const isLocked = (fixture: Guardable): boolean => lockReason(fixture) !== null;

/** Retire les projecteurs verrouillés d'une liste (sélection, scènes, effets…). */
export const unlocked = <T extends Guardable>(fixtures: T[]): T[] => fixtures.filter((f) => !isLocked(f));

/** Nombre de projecteurs verrouillés dans une liste, pour les compteurs d'UI. */
export const countLocked = (fixtures: Guardable[]): number =>
  fixtures.reduce((n, f) => (isLocked(f) ? n + 1 : n), 0);
