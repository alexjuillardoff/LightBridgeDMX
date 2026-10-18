// Helpers partages par plusieurs routes (endpoints) Fastify.
// Centralise les enchainements repetitifs pour eviter de les dupliquer.

import { Fixture } from "@lightbridgedmx/shared";
import {
  FixtureRelocation,
  facadeIds,
  fixtureBlock,
  planFacadeMoves,
  realignMirror
} from "../services/facade-patch";
import { FixtureInput, StoreError } from "../state/store";
import { RouteContext } from "./types";

/** Ce dont le repatch a besoin. Au demarrage, seuls le store et l'univers existent
 *  vraiment : sans le reste (lampes, HomeKit, WebSocket), on ne fait que la base
 *  et le tampon DMX, et les services liront le resultat en demarrant. */
type PatchContext = Pick<RouteContext, "store" | "dmx"> & Partial<RouteContext>;

// Cree un projecteur (fixture) puis propage le changement partout.
// Trois etapes a garder dans cet ordre : enregistrer dans le store, resynchroniser
// le pont HomeKit avec la liste complete a jour, puis diffuser (broadcast) la
// creation a tous les clients WebSocket pour que l'UI se mette a jour en direct.
//
// Le projecteur cree ici est un VRAI projecteur : patche par-dessus une facade de
// lampe connectee, il la pousse derriere lui avant d'etre enregistre.
export const createFixtureAndSync = async (ctx: RouteContext, input: FixtureInput): Promise<Fixture> => {
  await relocateFacades(ctx, (fixtures) => [
    ...fixtures,
    { ...input, id: input.id ?? "projecteur-en-creation", createdAt: "" }
  ]);
  const fixture = await ctx.store.createFixture(input);
  const fixtures = await ctx.store.listFixtures();
  await ctx.homekit.syncFixtures(fixtures);
  // La prise Meross re-resout aussi les canaux surveilles (un projecteur cible a pu changer).
  ctx.meross.syncFixtures(fixtures);
  ctx.broadcast({ type: "fixture_updated", data: fixture });
  return fixture;
};

/** Ids des projecteurs qui servent aujourd'hui de facade a une lampe connectee. */
export const currentFacadeIds = async (ctx: Pick<RouteContext, "store">): Promise<Set<string>> =>
  facadeIds(await ctx.store.listSmartLights(), await ctx.store.listFixtures());

/** Refuse de deplacer une facade a la main : son adresse est attribuee
 *  automatiquement, derriere les vrais projecteurs. La laisser bouger, c'etait
 *  accepter qu'elle revienne se glisser entre deux appareils physiques. */
export const assertFacadesStayPut = (
  fixtures: Fixture[],
  facades: Set<string>,
  moves: Array<{ id: string; address?: number; universe?: number }>
): void => {
  for (const move of moves) {
    const fixture = fixtures.find((f) => f.id === move.id);
    if (!fixture || !facades.has(fixture.id)) continue;
    const moved =
      (move.address !== undefined && move.address !== fixture.address) ||
      (move.universe !== undefined && move.universe !== fixture.universe);
    if (moved) {
      throw new StoreError(
        `« ${fixture.name} » est la façade DMX d'une lampe connectée : son adresse est attribuée automatiquement, après le dernier vrai projecteur.`,
        409
      );
    }
  }
};

/**
 * Range les facades derriere les vrais projecteurs, en emportant tout leur cablage.
 *
 * `prospective` decrit la disposition a respecter quand une modification est en
 * cours : on deplace les facades AVANT d'ecrire le vrai projecteur, pour qu'il
 * trouve sa place libre. Sans elle, on range la disposition de la base.
 *
 * L'ordre des etapes est ce qui rend le deplacement invisible sur les lampes :
 *   1. la base (validee d'un bloc : si la disposition est fausse, rien n'est ecrit) ;
 *   2. les valeurs DMX et les effets en cours, dans la meme trame ;
 *   3. les miroirs des lampes, qui lisent desormais la nouvelle adresse ;
 *   4. seulement alors, on vide les anciennes places — plus personne ne les lit.
 * Dans l'autre ordre, une lampe lirait un bloc vide le temps d'une trame : du noir.
 *
 * Renvoie les facades deplacees (avant/apres).
 */
export const relocateFacades = async (
  ctx: PatchContext,
  prospective?: (fixtures: Fixture[]) => Fixture[]
): Promise<FixtureRelocation[]> => {
  const fixtures = await ctx.store.listFixtures();
  const facades = facadeIds(await ctx.store.listSmartLights(), fixtures);
  const moves = planFacadeMoves(prospective ? prospective(fixtures) : fixtures, facades);
  if (!moves.length) return [];

  const updated = await ctx.store.repatchFixtures(moves);
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const relocations = updated.flatMap((after) => {
    const before = byId.get(after.id);
    return before ? [{ before, after }] : [];
  });

  // Code synchrone : aucune trame DMX ne peut partir entre ces deux lignes.
  ctx.dmx.copyBlocks(
    relocations.map(({ before, after }) => ({
      from: before.address,
      to: after.address,
      count: fixtureBlock(before).length
    }))
  );
  ctx.effects?.followRepatch(new Map(relocations.map(({ before, after }) => [after.id, after.address - before.address])));

  await realignSmartLightMirrors(ctx, relocations);

  // Une ancienne place peut etre devenue celle d'une autre facade : on ne vide que
  // ce que personne n'occupe plus.
  const occupied = new Set(relocations.flatMap(({ after }) => fixtureBlock(after)));
  for (const { before } of relocations) {
    for (const channel of fixtureBlock(before)) {
      if (!occupied.has(channel)) ctx.dmx.setChannel(channel, 0, "facade-patch");
    }
  }

  if (ctx.homekit) {
    const all = await ctx.store.listFixtures();
    await ctx.homekit.syncFixtures(all);
    ctx.meross?.syncFixtures(all);
  }
  relocations.forEach(({ after }) => ctx.broadcast?.({ type: "fixture_updated", data: after }));
  return relocations;
};

/** Fait suivre les miroirs DMX des lampes connectees quand un projecteur bouge.
 *
 *  Sur un pupitre, repatcher un appareil emmene tout son cablage avec lui : c'est
 *  ce qu'on fait ici pour la lampe dont il est la facade (voir realignMirror).
 *  Sans cela, le miroir continuait d'ecouter les anciens canaux, que plus
 *  personne ne pilote, et la lampe restait muette. */
export const realignSmartLightMirrors = async (
  ctx: Pick<RouteContext, "store"> & Partial<RouteContext>,
  moves: FixtureRelocation[]
): Promise<void> => {
  // On ne s'interesse qu'aux vrais deplacements.
  const relevant = moves.filter(
    ({ before, after }) => before.address !== after.address || before.universe !== after.universe
  );
  if (!relevant.length) return;

  for (const light of await ctx.store.listSmartLights()) {
    if (!light.dmxMirror) continue;
    const mirror = realignMirror(light.dmxMirror, relevant);
    if (!mirror) continue;
    const updated = await ctx.store.updateSmartLight(light.id, { dmxMirror: mirror });
    // Le service relit le miroir a l'enregistrement : sans ce register, il
    // continuerait d'ecouter les anciens canaux jusqu'au prochain redemarrage.
    // (Absent au demarrage : le service lira la base en demarrant.)
    await ctx.smartLights?.register(updated);
    ctx.broadcast?.({ type: "smart_light_updated", data: updated });
  }
};
