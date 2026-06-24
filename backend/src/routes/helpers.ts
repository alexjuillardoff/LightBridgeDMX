// Helpers partages par plusieurs routes (endpoints) Fastify.
// Centralise les enchainements repetitifs pour eviter de les dupliquer.

import { Fixture } from "@lightbridgedmx/shared";
import { FixtureInput } from "../state/store";
import { RouteContext } from "./types";

// Cree un projecteur (fixture) puis propage le changement partout.
// Trois etapes a garder dans cet ordre : enregistrer dans le store, resynchroniser
// le pont HomeKit avec la liste complete a jour, puis diffuser (broadcast) la
// creation a tous les clients WebSocket pour que l'UI se mette a jour en direct.
export const createFixtureAndSync = async (ctx: RouteContext, input: FixtureInput): Promise<Fixture> => {
  const fixture = await ctx.store.createFixture(input);
  const fixtures = await ctx.store.listFixtures();
  await ctx.homekit.syncFixtures(fixtures);
  // La prise Meross re-resout aussi les canaux surveilles (un projecteur cible a pu changer).
  ctx.meross.syncFixtures(fixtures);
  ctx.broadcast({ type: "fixture_updated", data: fixture });
  return fixture;
};
