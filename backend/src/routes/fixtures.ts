// Routes REST des projecteurs (fixtures) : liste, creation, mise a jour, suppression.
// Chaque ecriture passe par le store (persistance SQLite) puis resynchronise le
// pont HomeKit pour que l'app Maison reflete tout de suite les changements.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FixtureSchema } from "@lightbridgedmx/shared";
import { createFixtureAndSync, realignSmartLightMirrors } from "./helpers";
import { ErrorHandler, RouteContext } from "./types";

// Enregistre les endpoints /api/fixtures sur l'instance Fastify.
export const registerFixtureRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema d'entree : on retire id et createdAt (geres par le serveur) et on
  // autorise un id fourni par le client, a condition que ce soit un UUID valide.
  const fixtureInputSchema = FixtureSchema.omit({ id: true, createdAt: true }).extend({
    id: z.string().uuid().optional()
  });
  // En mise a jour, tous les champs sont optionnels (modification partielle).
  // `room` accepte en plus la valeur null : c'est le seul moyen de RETIRER un
  // projecteur de sa piece, JSON ne sachant pas transporter `undefined`.
  const fixtureUpdateSchema = fixtureInputSchema.partial().extend({
    room: z.string().min(1).nullish()
  });

  // Repatch groupe : une liste de deplacements valides ensemble.
  const repatchSchema = z.object({
    moves: z
      .array(
        z.object({
          id: z.string().uuid(),
          address: z.number().int().min(1).max(512),
          universe: z.number().int().min(0).optional()
        })
      )
      .min(1)
  });

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
      // room: null -> undefined, mais la CLE reste presente : c'est elle qui,
      // fusionnee sur le projecteur existant, efface la piece. Une cle absente
      // (room jamais envoye) laisse au contraire la piece intacte.
      const { room, ...fields } = parsed;
      const patch = "room" in parsed ? { ...fields, room: room ?? undefined } : fields;
      const id = (request.params as { id: string }).id;
      // Etat AVANT modification : c'est lui qui dit quels canaux le projecteur
      // liberait, donc quels miroirs de lampes doivent suivre le deplacement.
      const before = await ctx.store.getFixture(id);
      const fixture = await ctx.store.updateFixture(id, patch);
      if (before) await realignSmartLightMirrors(ctx, [{ before, after: fixture }]);
      // Resynchronise le pont HomeKit (et la prise Meross) avec la liste a jour, puis previent
      // les clients WebSocket par une diffusion (broadcast) du projecteur modifie.
      const fixtures = await ctx.store.listFixtures();
      await ctx.homekit.syncFixtures(fixtures);
      ctx.meross.syncFixtures(fixtures);
      ctx.broadcast({ type: "fixture_updated", data: fixture });
      reply.send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // POST /repatch : deplace plusieurs projecteurs en une seule operation validee.
  // Indispensable pour decaler une serie : voir store.repatchFixtures.
  app.post("/api/fixtures/repatch", async (request, reply) => {
    try {
      const { moves } = repatchSchema.parse(request.body);
      const beforeAll = new Map((await ctx.store.listFixtures()).map((f) => [f.id, f]));
      const updated = await ctx.store.repatchFixtures(moves);
      await realignSmartLightMirrors(
        ctx,
        updated.flatMap((after) => {
          const before = beforeAll.get(after.id);
          return before ? [{ before, after }] : [];
        })
      );
      const fixtures = await ctx.store.listFixtures();
      await ctx.homekit.syncFixtures(fixtures);
      ctx.meross.syncFixtures(fixtures);
      updated.forEach((fixture) => ctx.broadcast({ type: "fixture_updated", data: fixture }));
      reply.send(updated);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // DELETE : supprime un projecteur puis resynchronise HomeKit. Reponse 204 (sans corps).
  app.delete("/api/fixtures/:id", async (request, reply) => {
    try {
      await ctx.store.deleteFixture((request.params as { id: string }).id);
      const fixtures = await ctx.store.listFixtures();
      await ctx.homekit.syncFixtures(fixtures);
      ctx.meross.syncFixtures(fixtures);
      reply.code(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });
};
