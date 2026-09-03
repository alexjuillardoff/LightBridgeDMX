// Garde-fou de securite : projecteurs verrouilles.
//
// Certains projecteurs ne doivent JAMAIS etre allumes depuis le pupitre (le PAR
// de la chambre, par exemple, quand quelqu'un y dort). Les masquer serait un
// mauvais garde-fou : un projecteur invisible finit par etre rallume "par
// accident" depuis la ligne de commande ou une scene rappelee.
//
// On les laisse donc visibles, mais VERROUILLES : marques d'un cadenas dans la
// fixture sheet, non selectionnables, ignores par ALL / FULL / les encodeurs, et
// exclus des scenes au moment de leur enregistrement comme de leur rappel.
//
// Regle : liste blanche par defaut. Un projecteur dont la piece n'est pas
// confirmee et dont le nom evoque la chambre est verrouille tant qu'on ne l'a
// pas explicitement autorise en le retirant d'ici.

// Forme minimale exigee : tout ce que la garde a besoin de lire.
type Guardable = { id: string; name: string; room?: string | null };

// Pieces dont tous les projecteurs sont verrouilles.
const LOCKED_ROOMS = new Set(["chambre", "bedroom"]);

// Un nom qui evoque la chambre suffit a verrouiller, meme sans piece renseignee :
// un projecteur mal range ne doit pas passer entre les mailles.
const LOCKED_NAME_PATTERN = /\bchambre\b|\bbedroom\b/i;

// Verrous nominatifs, par id. A remplir quand un projecteur doit etre bloque
// sans que son nom ni sa piece ne le trahissent.
const LOCKED_FIXTURE_IDS = new Set<string>([]);

/** Raison du verrou, ou null si le projecteur est pilotable. */
export const lockReason = (fixture: Guardable): string | null => {
  if (LOCKED_FIXTURE_IDS.has(fixture.id)) return "Verrouillé manuellement";
  const room = fixture.room?.trim().toLowerCase();
  if (room && LOCKED_ROOMS.has(room)) return `Pièce protégée : ${fixture.room}`;
  if (LOCKED_NAME_PATTERN.test(fixture.name)) return "Projecteur de chambre";
  return null;
};

/** true si ce projecteur ne doit etre allume sous aucun pretexte. */
export const isLockedFixture = (fixture: Guardable): boolean => lockReason(fixture) !== null;

/** Retire les projecteurs verrouilles d'une liste (selection, scenes, effets...). */
export const unlockedOnly = <T extends Guardable>(fixtures: T[]): T[] =>
  fixtures.filter((f) => !isLockedFixture(f));

/** Nombre de projecteurs verrouilles dans une liste, pour les compteurs d'UI. */
export const countLocked = (fixtures: Guardable[]): number =>
  fixtures.reduce((n, f) => (isLockedFixture(f) ? n + 1 : n), 0);
