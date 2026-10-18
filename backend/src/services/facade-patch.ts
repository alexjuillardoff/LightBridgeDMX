// =============================================================================
// Patch automatique des FACADES DMX.
//
// Une facade est un projecteur DMX sans existence physique : le bloc de canaux
// par lequel une lampe connectee (ampoule Thread, bandeau Nanoleaf) se pilote
// depuis l'univers. Rien ne l'attend au bout du cable XLR.
//
// La regle : les vrais projecteurs gardent l'adresse qu'on leur donne, et les
// facades se rangent APRES le dernier vrai canal utilise. Une facade glissee
// dans un trou entre deux vrais projecteurs, ou rattrapee par un projecteur
// qu'on vient de patcher, est decalee vers la premiere place libre derriere.
// Celles qui sont deja bien placees ne bougent pas : on decale ce qui gene, pas
// tout le patch.
//
// Ce module ne fait que planifier : il ne touche ni a la base ni a l'univers.
// L'execution (valeurs DMX, miroirs, effets en cours) vit dans routes/helpers.
// =============================================================================
import type { Fixture, SmartLight, SmartLightDmxMirror } from "@lightbridgedmx/shared";
import { findFacadeFixture } from "./homekit-utils";

/** Deplacement d'une facade : nouvelle adresse, dans le meme univers. */
export type FacadeMove = { id: string; address: number };

/** Un projecteur avant et apres un repatch. */
export type FixtureRelocation = { before: Fixture; after: Fixture };

/** Plus aucune place derriere les vrais projecteurs pour loger une facade. */
export class FacadeRoomError extends Error {}

/** Ids des projecteurs qui servent de facade a une lampe connectee. */
export const facadeIds = (lights: SmartLight[], fixtures: Fixture[]): Set<string> => {
  const ids = new Set<string>();
  for (const light of lights) {
    const facade = findFacadeFixture(light, fixtures);
    if (facade) ids.add(facade.id);
  }
  return ids;
};

/** Canaux reserves par un projecteur : de son adresse a son plus grand offset.
 *  Un trou dans ses canaux reste a lui — on ne loge rien au milieu d'un appareil. */
export const fixtureBlock = (fixture: Pick<Fixture, "address" | "channels">): number[] => {
  const size = Math.max(0, ...fixture.channels.map((ch) => ch.channel));
  return Array.from({ length: size }, (_, i) => fixture.address + i);
};

/** Dernier canal occupe par un vrai projecteur dans cet univers (0 s'il n'y en a aucun). */
export const lastRealChannel = (fixtures: Fixture[], facades: Set<string>, universe: number): number =>
  fixtures
    .filter((f) => f.universe === universe && !facades.has(f.id))
    .reduce((last, f) => Math.max(last, ...fixtureBlock(f)), 0);

/** Premiere adresse apres `after` ou `size` canaux consecutifs sont libres, ou null. */
const firstFreeBlock = (occupied: Set<number>, size: number, after: number): number | null => {
  for (let start = after + 1; start + size - 1 <= 512; start++) {
    let free = true;
    for (let c = start; c < start + size; c++) {
      if (occupied.has(c)) {
        // Inutile de retester les departs qui recouvriraient ce canal.
        start = c;
        free = false;
        break;
      }
    }
    if (free) return start;
  }
  return null;
};

/** Canaux deja pris par les facades de cet univers (sauf `ignoreId`). */
const facadeChannels = (
  fixtures: Fixture[],
  facades: Set<string>,
  universe: number,
  ignoreId?: string
): Set<number> => {
  const occupied = new Set<number>();
  for (const f of fixtures) {
    if (f.universe !== universe || f.id === ignoreId || !facades.has(f.id)) continue;
    fixtureBlock(f).forEach((c) => occupied.add(c));
  }
  return occupied;
};

/**
 * Adresse ou loger une facade de `size` canaux : `preferred` si elle respecte la
 * regle (derriere le dernier vrai canal, sans chevaucher une autre facade), sinon
 * la premiere place libre derriere les vrais projecteurs. null si l'univers est plein.
 *
 * `ignoreId` : la facade elle-meme quand on la redimensionne, pour qu'elle ne se
 * bloque pas sa propre place.
 */
export const placeFacade = (
  fixtures: Fixture[],
  facades: Set<string>,
  opts: { size: number; universe: number; preferred?: number; ignoreId?: string }
): number | null => {
  const { size, universe, preferred, ignoreId } = opts;
  const others = fixtures.filter((f) => f.id !== ignoreId);
  const last = lastRealChannel(others, facades, universe);
  const occupied = facadeChannels(others, facades, universe);
  if (preferred !== undefined && preferred > last && preferred + size - 1 <= 512) {
    const block = Array.from({ length: size }, (_, i) => preferred + i);
    if (block.every((c) => !occupied.has(c))) return preferred;
  }
  return firstFreeBlock(occupied, size, last);
};

/**
 * Planifie le rangement des facades derriere les vrais projecteurs.
 *
 * `fixtures` est la disposition a respecter : celle de la base, ou celle qu'elle
 * aura une fois appliquee la modification en cours (un projecteur qu'on
 * s'apprete a patcher par-dessus une facade). Renvoie seulement les facades a
 * deplacer.
 *
 * Leve FacadeRoomError si une facade ne tient plus derriere les vrais canaux :
 * mieux vaut refuser la modification que laisser deux projecteurs sur un slot.
 */
export const planFacadeMoves = (fixtures: Fixture[], facades: Set<string>): FacadeMove[] => {
  const moves: FacadeMove[] = [];
  const universes = new Set(fixtures.filter((f) => facades.has(f.id)).map((f) => f.universe));

  for (const universe of universes) {
    const last = lastRealChannel(fixtures, facades, universe);
    const ordered = fixtures
      .filter((f) => f.universe === universe && facades.has(f.id))
      .sort((a, b) => a.address - b.address);

    // Les facades deja bien placees gardent leur adresse.
    const occupied = new Set<number>();
    const misplaced: Fixture[] = [];
    for (const facade of ordered) {
      const block = fixtureBlock(facade);
      const fits =
        facade.address > last && block[block.length - 1] <= 512 && block.every((c) => !occupied.has(c));
      if (fits) block.forEach((c) => occupied.add(c));
      else misplaced.push(facade);
    }

    // On evite d'abord d'atterrir sur l'ancienne place d'une facade qui bouge elle
    // aussi : pendant le deplacement, sa lampe y lit encore ses canaux, et y
    // recopier les valeurs d'une autre la ferait clignoter. Si l'univers est trop
    // plein pour ce luxe, on s'en tient a la regle.
    const vacated = new Set(misplaced.flatMap(fixtureBlock));
    for (const facade of misplaced) {
      const size = fixtureBlock(facade).length;
      const address =
        firstFreeBlock(new Set([...occupied, ...vacated]), size, last) ??
        firstFreeBlock(occupied, size, last);
      if (address === null) {
        throw new FacadeRoomError(
          `Plus de place pour la façade « ${facade.name} » (${size} canaux) après le dernier vrai projecteur, au canal ${universe}.${last}`
        );
      }
      for (let c = address; c < address + size; c++) occupied.add(c);
      if (address !== facade.address) moves.push({ id: facade.id, address });
    }
  }
  return moves;
};

// Cles du miroir uniforme : des canaux ABSOLUS, sans lien avec le projecteur.
const UNIFORM_KEYS = ["rChannel", "gChannel", "bChannel", "briChannel", "ctChannel"] as const;

/** Miroir DMX d'une lampe une fois des projecteurs deplaces, ou null s'il ne change pas.
 *
 *  Le miroir uniforme (`rChannel`, `gChannel`...) memorise des canaux ABSOLUS, pas
 *  un lien vers le projecteur qui les occupe : on decale du meme delta ceux qui
 *  tombaient dans l'ancienne empreinte du projecteur. Le miroir par zone porte
 *  deja `fixtureId` : on suit ce lien plutot que les canaux — et le master avec,
 *  sans quoi le bandeau continuerait de lire son intensite a l'ancienne adresse. */
export const realignMirror = (
  mirror: SmartLightDmxMirror,
  relocations: FixtureRelocation[]
): SmartLightDmxMirror | null => {
  let next: SmartLightDmxMirror = { ...mirror };
  let changed = false;

  for (const { before, after } of relocations) {
    if (before.address === after.address && before.universe === after.universe) continue;
    const delta = after.address - before.address;
    const footprint = new Set(before.channels.map((ch) => before.address + ch.channel - 1));

    // Miroir uniforme : on ne deplace que les canaux qui appartenaient reellement
    // a ce projecteur, dans l'univers ou le miroir ecoute.
    if ((next.universe ?? 0) === before.universe) {
      const defined = UNIFORM_KEYS.filter((key) => next[key] !== undefined);
      const inside = defined.filter((key) => footprint.has(next[key] as number));
      for (const key of inside) {
        next = { ...next, [key]: (next[key] as number) + delta };
        changed = true;
      }
      // L'univers ne suit que si TOUT le miroir suivait ce projecteur : un miroir
      // a cheval sur deux projecteurs ne doit pas changer d'univers.
      if (inside.length && inside.length === defined.length && after.universe !== before.universe) {
        next = { ...next, universe: after.universe };
        changed = true;
      }
    }

    // Miroir par zone : le lien est nomme, on n'a pas a deviner.
    if (next.zones?.fixtureId === before.id) {
      const { dimmerChannel } = next.zones;
      next = {
        ...next,
        zones: {
          ...next.zones,
          startChannel: next.zones.startChannel + delta,
          ...(dimmerChannel !== undefined ? { dimmerChannel: dimmerChannel + delta } : {}),
          universe: after.universe
        }
      };
      changed = true;
    }
  }

  return changed ? next : null;
};
