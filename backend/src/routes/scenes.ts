import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SceneSchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

export const registerSceneRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const sceneInputSchema = SceneSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional()
  });

  app.get("/api/scenes", async () => ctx.store.listScenes());

  app.post("/api/scenes", async (request, reply) => {
    try {
      const parsed = sceneInputSchema.parse(request.body);
      const scene = await ctx.store.createScene(parsed);
      reply.code(201).send(scene);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/scenes/:id/activate", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const scene = await ctx.store.getScene(id);
      if (!scene) return reply.code(404).send({ message: "Scene not found" });

      for (const step of scene.steps) {
        const fixture = await ctx.store.getFixture(step.fixtureId);
        if (!fixture) continue;
        ctx.dmx.applyWrite({ address: fixture.address, values: step.values });
      }

      ctx.broadcast({ type: "scene_activated", data: scene });
      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
