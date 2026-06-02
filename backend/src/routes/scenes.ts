// Routes REST des scenes (etats enregistres rappelables).
// Expose la liste, la creation et l'activation d'une scene.
// Activer une scene rejoue ses pas sur le DMX puis previent les clients via WebSocket.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SceneSchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

export const registerSceneRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Schema d'entree pour creer une scene : on retire l'id (genere cote store)
  // et on l'autorise en option (UUID) si l'appelant veut l'imposer.
  const sceneInputSchema = SceneSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional()
  });

  // GET : renvoie toutes les scenes enregistrees.
  app.get("/api/scenes", async () => ctx.store.listScenes());

  // POST : cree une scene apres validation Zod du corps de la requete.
  // Repond 201 (Created) avec la scene creee.
  app.post("/api/scenes", async (request, reply) => {
    try {
      const parsed = sceneInputSchema.parse(request.body);
      const scene = await ctx.store.createScene(parsed);
      reply.code(201).send(scene);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // POST : active une scene, c'est-a-dire rappelle son etat lumineux enregistre.
  app.post("/api/scenes/:id/activate", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const scene = await ctx.store.getScene(id);
      if (!scene) return reply.code(404).send({ message: "Scene not found" });

      // Chaque pas vise un projecteur et ses valeurs de canaux : on les ecrit sur le DMX.
      // On ignore les pas dont le projecteur a ete supprime depuis (continue).
      for (const step of scene.steps) {
        const fixture = await ctx.store.getFixture(step.fixtureId);
        if (!fixture) continue;
        ctx.dmx.applyWrite({ address: fixture.address, values: step.values });
      }

      // Diffusion (broadcast) WebSocket pour que toutes les UI connectees se mettent a jour.
      ctx.broadcast({ type: "scene_activated", data: scene });
      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
