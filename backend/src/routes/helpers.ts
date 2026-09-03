// Helpers partages par plusieurs routes (endpoints) Fastify.
// Centralise les enchainements repetitifs pour eviter de les dupliquer.

import { Fixture, SmartLightDmxMirror } from "@lightbridgedmx/shared";
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

// Canaux DMX absolus occupes par un projecteur.
const absoluteChannels = (fixture: Fixture): number[] =>
  fixture.channels.map((ch) => fixture.address + ch.channel - 1);

// Cles du miroir uniforme : des canaux ABSOLUS, sans lien avec le projecteur.
const UNIFORM_KEYS = ["rChannel", "gChannel", "bChannel", "briChannel"] as const;

/** Fait suivre les miroirs DMX des lampes connectees quand un projecteur bouge.
 *
 *  Le miroir uniforme d'une lampe (`rChannel`, `gChannel`...) memorise des canaux
 *  ABSOLUS, pas un lien vers le projecteur qui les occupe. Repatcher le projecteur
 *  qui sert de facade DMX a une lampe la laissait donc muette : le miroir
 *  continuait d'ecouter les anciens canaux, que plus personne ne pilote. Sur un
 *  pupitre, repatcher un appareil emmene tout son cablage avec lui — c'est ce
 *  qu'on fait ici, en decalant du meme delta les canaux du miroir qui tombaient
 *  dans l'ancienne empreinte du projecteur.
 *
 *  Le miroir par zone, lui, porte deja `fixtureId` : le lien est explicite, on
 *  suit ce lien plutot que les canaux. */
export const realignSmartLightMirrors = async (
  ctx: RouteContext,
  moves: { before: Fixture; after: Fixture }[]
): Promise<void> => {
  // On ne s'interesse qu'aux vrais deplacements.
  const relevant = moves.filter(
    ({ before, after }) => before.address !== after.address || before.universe !== after.universe
  );
  if (!relevant.length) return;

  const lights = await ctx.store.listSmartLights();

  for (const light of lights) {
    if (!light.dmxMirror) continue;
    let mirror: SmartLightDmxMirror = { ...light.dmxMirror };
    let changed = false;

    for (const { before, after } of relevant) {
      const delta = after.address - before.address;
      const footprint = new Set(absoluteChannels(before));
      const mirrorUniverse = mirror.universe ?? 0;

      // Miroir uniforme : on ne deplace que les canaux qui appartenaient
      // reellement a ce projecteur, dans l'univers ou le miroir ecoute.
      if (mirrorUniverse === before.universe) {
        const defined = UNIFORM_KEYS.filter((key) => mirror[key] !== undefined);
        const inside = defined.filter((key) => footprint.has(mirror[key] as number));
        for (const key of inside) {
          mirror = { ...mirror, [key]: (mirror[key] as number) + delta };
          changed = true;
        }
        // L'univers ne suit que si TOUT le miroir suivait ce projecteur : un
        // miroir a cheval sur deux projecteurs ne doit pas changer d'univers.
        if (inside.length && inside.length === defined.length && after.universe !== before.universe) {
          mirror = { ...mirror, universe: after.universe };
          changed = true;
        }
      }

      // Miroir par zone : le lien est nomme, on n'a pas a deviner.
      if (mirror.zones?.fixtureId === before.id) {
        mirror = {
          ...mirror,
          zones: {
            ...mirror.zones,
            startChannel: mirror.zones.startChannel + delta,
            universe: after.universe
          }
        };
        changed = true;
      }
    }

    if (!changed) continue;
    const updated = await ctx.store.updateSmartLight(light.id, { dmxMirror: mirror });
    // Le service relit le miroir a l'enregistrement : sans ce register, il
    // continuerait d'ecouter les anciens canaux jusqu'au prochain redemarrage.
    await ctx.smartLights.register(updated);
    ctx.broadcast({ type: "smart_light_updated", data: updated });
  }
};
