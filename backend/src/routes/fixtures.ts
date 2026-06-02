// Routes REST des projecteurs (fixtures) : liste, creation, mise a jour, suppression.
// Chaque ecriture passe par le store (persistance SQLite) puis resynchronise le
// pont HomeKit pour que l'app Maison reflete tout de suite les changements.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FixtureSchema } from "@lightbridgedmx/shared";
import { createFixtureAndSync } from "./helpers";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre les endpoints /api/fixtures sur l'instance Fastify.
export const registerFixtureRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema d'entree : on retire id et createdAt (geres par le serveur) et on
  // autorise un id fourni par le client, a condition que ce soit un UUID valide.
  const fixtureInputSchema = FixtureSchema.omit({ id: true, createdAt: true }).extend({
    id: z.string().uuid().optional()
  });
  // En mise a jour, tous les champs sont optionnels (modification partielle).
  const fixtureUpdateSchema = fixtureInputSchema.partial();

  // GET : renvoie la liste de tous les projecteurs enregistres.
  app.get("/api/fixtures", async () => ctx.store.listFixtures());

  // POST : cree un projecteur. Le helper createFixtureAndSync persiste le projecteur
  // ET resynchronise HomeKit en une seule etape. Reponse 201 (cree).
  app.post("/api/fixtures", async (request, reply) => {
    try {
      const parsed = fixtureInputSchema.parse(request.body);
      const fixture = await createFixtureAndSync(ctx, parsed);
      reply.code(201).send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // PUT : met a jour un projecteur existant (par son id).
  app.put("/api/fixtures/:id", async (request, reply) => {
    try {
      const parsed = fixtureUpdateSchema.parse(request.body);
      const fixture = await ctx.store.updateFixture((request.params as { id: string }).id, parsed);
      // Resynchronise le pont HomeKit avec la liste a jour, puis previent les
      // clients WebSocket par une diffusion (broadcast) du projecteur modifie.
      await ctx.homekit.syncFixtures(await ctx.store.listFixtures());
      ctx.broadcast({ type: "fixture_updated", data: fixture });
      reply.send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // DELETE : supprime un projecteur puis resynchronise HomeKit. Reponse 204 (sans corps).
  app.delete("/api/fixtures/:id", async (request, reply) => {
    try {
      await ctx.store.deleteFixture((request.params as { id: string }).id);
      await ctx.homekit.syncFixtures(await ctx.store.listFixtures());
      reply.code(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });
};
