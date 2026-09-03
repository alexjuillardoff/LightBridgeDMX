// Outils purs du patch DMX — l'equivalent de ce que grandMA2 appelle le
// "Fixture Schedule" : ou commence et ou finit chaque projecteur dans l'univers,
// qui marche sur les pieds de qui, et ou reste-t-il de la place.
//
// Tout est calcul pur (aucun appel reseau) pour que la table du patch puisse
// recalculer conflits et trous a chaque frappe sans coup au serveur. Le backend
// refuse de toute facon les chevauchements (409) : ce qui est ici sert a le dire
// AVANT d'envoyer, pas a le remplacer.
import { Fixture, FixtureChannel } from "@lightbridgedmx/shared";

// Ce dont on a besoin pour situer un projecteur : son adresse, son univers et
// ses canaux. Volontairement plus large que Fixture pour accepter aussi un
// projecteur en cours d'edition, qui n'a pas encore d'id.
export type Patchable = {
  address: number;
  universe: number;
  channels: FixtureChannel[];
};

/** Canaux DMX absolus (1-512) occupes par un projecteur.
 *  Canal absolu = adresse de depart + numero de canal relatif - 1. */
export const absoluteChannels = (fixture: Patchable): number[] =>
  fixture.channels.map((ch) => fixture.address + ch.channel - 1);

/** Encombrement d'un projecteur : du premier au dernier canal occupe.
 *  Un profil QXF peut laisser des trous, d'ou start/end distincts du nombre de canaux. */
export const footprint = (fixture: Patchable) => {
  const channels = absoluteChannels(fixture);
  return {
    start: Math.min(...channels),
    end: Math.max(...channels),
    count: channels.length
  };
};

/** Nombre de slots DMX qu'un jeu de canaux consomme depuis l'adresse de depart.
 *  C'est le plus grand numero relatif : un profil 1/2/8 occupe 8 slots, pas 3. */
export const channelSpan = (channels: FixtureChannel[]): number =>
  channels.reduce((max, ch) => Math.max(max, ch.channel), 0);

/** Adresse de patch au format pupitre : "0.001" = univers 0, canal 1. */
export const formatPatch = (universe: number, address: number): string =>
  `${universe}.${String(address).padStart(3, "0")}`;

// Un chevauchement : l'autre projecteur en cause et les canaux partages.
export type PatchConflict = {
  id: string;
  name: string;
  channels: number[];
};

/** Table des chevauchements d'adresses, indexee par id de projecteur.
 *
 *  Deux projecteurs sont en conflit s'ils sont dans le MEME univers et occupent
 *  au moins un canal commun — c'est exactement le "patch conflict" que MA2
 *  affiche en rouge dans le Fixture Schedule. Un id absent de la table est sain.
 *
 *  Quadratique, mais sur des dizaines de projecteurs c'est gratuit et ca evite
 *  d'entretenir un index a invalider. */
export const buildConflictMap = (fixtures: Fixture[]): Map<string, PatchConflict[]> => {
  const map = new Map<string, PatchConflict[]>();
  // Un Set par projecteur, calcule une seule fois puis compare a tous les autres.
  const sets = fixtures.map((fixture) => ({ fixture, channels: new Set(absoluteChannels(fixture)) }));

  const add = (id: string, conflict: PatchConflict) => {
    const list = map.get(id) ?? [];
    list.push(conflict);
    map.set(id, list);
  };

  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      if (a.fixture.universe !== b.fixture.universe) continue;
      const shared = [...a.channels].filter((ch) => b.channels.has(ch)).sort((x, y) => x - y);
      if (!shared.length) continue;
      // Le conflit est symetrique : les deux lignes doivent s'allumer en rouge.
      add(a.fixture.id, { id: b.fixture.id, name: b.fixture.name, channels: shared });
      add(b.fixture.id, { id: a.fixture.id, name: a.fixture.name, channels: shared });
    }
  }
  return map;
};

/** Canaux deja pris dans un univers, en ignorant eventuellement un projecteur
 *  (celui qu'on est en train de deplacer : il ne doit pas se bloquer lui-meme). */
export const occupiedChannels = (fixtures: Fixture[], universe: number, ignoreId?: string): Set<number> => {
  const taken = new Set<number>();
  fixtures.forEach((fixture) => {
    if (fixture.universe !== universe || fixture.id === ignoreId) return;
    absoluteChannels(fixture).forEach((ch) => taken.add(ch));
  });
  return taken;
};

type FreeAddressInput = {
  fixtures: Fixture[];
  universe: number;
  channels: FixtureChannel[];
  ignoreId?: string;
  // Adresse a partir de laquelle chercher (pour patcher une serie a la suite).
  from?: number;
};

/** Premiere adresse ou ce jeu de canaux tient sans chevaucher personne.
 *  null si l'univers est trop plein — l'appelant doit le dire plutot que de
 *  proposer une adresse invalide. */
export const nextFreeAddress = ({
  fixtures,
  universe,
  channels,
  ignoreId,
  from = 1
}: FreeAddressInput): number | null => {
  const span = channelSpan(channels);
  if (span < 1) return null;
  const taken = occupiedChannels(fixtures, universe, ignoreId);
  for (let address = Math.max(1, from); address + span - 1 <= 512; address += 1) {
    const fits = channels.every((ch) => !taken.has(address + ch.channel - 1));
    if (fits) return address;
  }
  return null;
};

type SeriesInput = Omit<FreeAddressInput, "from"> & { count: number; from?: number };

/** Adresses de depart d'une SERIE de projecteurs identiques, patches a la suite.
 *
 *  On ne peut pas se contenter d'appeler nextFreeAddress en boucle : les
 *  projecteurs de la serie n'existent pas encore, donc rien ne les empecherait
 *  de recevoir tous la meme adresse. On tient donc un jeu de canaux occupes
 *  local, qu'on enrichit au fur et a mesure du placement.
 *
 *  null si la serie ne tient pas dans l'univers. */
export const planSeriesAddresses = ({
  fixtures,
  universe,
  channels,
  count,
  ignoreId,
  from = 1
}: SeriesInput): number[] | null => {
  const span = channelSpan(channels);
  if (span < 1 || count < 1) return null;
  const taken = occupiedChannels(fixtures, universe, ignoreId);
  const addresses: number[] = [];
  let cursor = Math.max(1, from);

  for (let i = 0; i < count; i += 1) {
    let placed = false;
    for (let address = cursor; address + span - 1 <= 512; address += 1) {
      if (!channels.every((ch) => !taken.has(address + ch.channel - 1))) continue;
      addresses.push(address);
      channels.forEach((ch) => taken.add(address + ch.channel - 1));
      cursor = address + span;
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  return addresses;
};

/** Verifie qu'un projecteur tient dans l'univers (pas de canal au-dela de 512). */
export const overflowsUniverse = (fixture: Patchable): boolean => footprint(fixture).end > 512;

// ----- Tri de la table du patch -----

export type SortKey = "id" | "name" | "patch" | "room" | "channels";
export type SortDir = "asc" | "desc";

// Une ligne de la table : le projecteur plus son numero de patch (l'index global
// dans la liste, qui reste stable quel que soit le tri de l'affichage).
export type PatchRow = { fixture: Fixture; number: number };

/** Trie les lignes selon la colonne demandee. Le tri est purement visuel :
 *  le numero de projecteur (colonne ID) ne bouge pas, c'est lui qui sert de
 *  reference a la ligne de commande et a la fixture sheet. */
export const sortRows = (rows: PatchRow[], key: SortKey, dir: SortDir): PatchRow[] => {
  const sign = dir === "asc" ? 1 : -1;
  const compare = (a: PatchRow, b: PatchRow): number => {
    switch (key) {
      case "name":
        return a.fixture.name.localeCompare(b.fixture.name, "fr");
      case "room":
        // Les projecteurs sans piece finissent en bas quel que soit le sens.
        return (a.fixture.room ?? "￿").localeCompare(b.fixture.room ?? "￿", "fr");
      case "channels":
        return a.fixture.channels.length - b.fixture.channels.length;
      case "patch":
        return (
          a.fixture.universe - b.fixture.universe ||
          a.fixture.address - b.fixture.address
        );
      case "id":
      default:
        return a.number - b.number;
    }
  };
  // Tri stable avec l'ordre de patch comme depart, pour que deux lignes
  // egales (meme piece, par exemple) restent dans un ordre previsible.
  return [...rows].sort((a, b) => compare(a, b) * sign || a.number - b.number);
};

/** Filtre texte de la table : nom, piece, adresse, modele QXF. */
export const matchesQuery = (fixture: Fixture, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    fixture.name,
    fixture.room ?? "",
    formatPatch(fixture.universe, fixture.address),
    String(fixture.address),
    fixture.profile ? `${fixture.profile.manufacturer} ${fixture.profile.model} ${fixture.profile.mode}` : ""
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
};

/** Nom d'un projecteur dans une serie : "PAR LED" -> "PAR LED 1", "PAR LED 2"...
 *  Un seul exemplaire garde le nom nu, comme sur un pupitre. */
export const seriesName = (base: string, index: number, total: number): string =>
  total > 1 ? `${base} ${index + 1}` : base;

/** Libelle court du modele d'un projecteur (colonne "Type" facon MA2). */
export const fixtureTypeLabel = (fixture: Fixture): string => {
  if (fixture.profile) return `${fixture.profile.manufacturer} ${fixture.profile.model}`;
  // Sans profil QXF, le "type" le plus parlant reste la signature des roles.
  const caps = fixture.channels.map((ch) => ch.capability);
  if (caps.includes("pan") || caps.includes("tilt")) return "Lyre";
  if (caps.includes("r") && caps.includes("g") && caps.includes("b")) {
    return caps.includes("w") ? "RGBW" : "RGB";
  }
  if (caps.includes("intensity") && caps.length === 1) return "Dimmer";
  return "Générique";
};
