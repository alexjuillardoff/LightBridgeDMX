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
