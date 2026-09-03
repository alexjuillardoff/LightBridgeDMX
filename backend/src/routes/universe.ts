// Routes (endpoints) Fastify de l'univers DMX.
// Permettent d'ecrire directement dans les 512 canaux : tester un projecteur
// (en lui envoyant une serie de valeurs depuis son adresse de depart) ou
// forcer la valeur d'un seul canal de l'univers DMX.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre les routes liees a l'univers DMX sur l'instance Fastify.
export const registerUniverseRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schemas Zod de validation : chaque canal doit etre un entier 0-255.
  // testBody : liste de valeurs (au moins une) ecrites a partir de l'adresse du projecteur.
  const testBodySchema = z.object({ values: z.array(z.number().int().min(0).max(255)).min(1) });
  // channelBody : une seule valeur pour un canal precis.
  // Corps du POST groupe : une table { "<canal>": valeur }. On borne a 512 entrees,
// soit l'univers entier — au-dela, c'est forcement une erreur d'appel.
const bulkBodySchema = z.object({
  values: z.record(z.string(), z.number().int().min(0).max(255))
}).refine((b) => Object.keys(b.values).length <= 512, {
  message: "Trop de canaux (512 maximum)"
});

const channelBodySchema = z.object({ value: z.number().int().min(0).max(255) });

  // Test d'un projecteur (fixture) : applique une serie de valeurs a partir de son adresse de depart.
  app.post("/api/test/fixtures/:id", async (request, reply) => {
    try {
      const parsed = testBodySchema.parse(request.body);
      const fixture = await ctx.store.getFixture((request.params as { id: string }).id);
      if (!fixture) return reply.code(404).send({ message: "Fixture not found" });

      // Ecrit les valeurs a partir de l'adresse de depart du projecteur.
      ctx.dmx.applyWrite({ address: fixture.address, values: parsed.values });
      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });

  /**
   * Ecrit plusieurs canaux en UNE requete.
   *
   * La console envoyait un POST par evenement de mouvement de fader, soit ~60 par
   * seconde et par curseur. Le navigateur ne tenant que ~6 connexions simultanees
   * par origine, la position FINALE du fader se retrouvait a la queue derriere des
   * dizaines de requetes deja perimees : le curseur paraissait mou, d'autant plus
   * qu'on bougeait plusieurs canaux a la fois.
   *
   * Le client regroupe donc ses changements et n'envoie ici que la derniere valeur
   * voulue de chaque canal.
   */
  app.post("/api/universe", async (request, reply) => {
    try {
      const parsed = bulkBodySchema.parse(request.body);
      for (const [rawChannel, value] of Object.entries(parsed.values)) {
        const channel = Number(rawChannel);
        if (!Number.isInteger(channel) || channel < 1 || channel > 512) {
          return reply.code(400).send({ message: `Invalid channel: ${rawChannel}` });
        }
        ctx.dmx.setChannel(channel, value);
      }
      reply.send({ ok: true, count: Object.keys(parsed.values).length });
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Force la valeur d'un seul canal de l'univers DMX (utile pour la console / les tests manuels).
  app.post("/api/universe/:channel", async (request, reply) => {
    try {
      const channel = Number((request.params as { channel: string }).channel);
      // Un univers DMX contient 512 canaux, numerotes de 1 a 512 : on rejette tout le reste.
      if (!Number.isInteger(channel) || channel < 1 || channel > 512) {
        return reply.code(400).send({ message: "Invalid channel" });
      }

      const parsed = channelBodySchema.parse(request.body);
      ctx.dmx.setChannel(channel, parsed.value);
      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
