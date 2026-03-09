import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FixtureSchema } from "@lightbridgedmx/shared";
import { createFixtureAndSync } from "./helpers";
import { ErrorHandler, RouteContext } from "./types";

export const registerFixtureRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const fixtureInputSchema = FixtureSchema.omit({ id: true, createdAt: true }).extend({
    id: z.string().uuid().optional()
  });
  const fixtureUpdateSchema = fixtureInputSchema.partial();

  app.get("/api/fixtures", async () => ctx.store.listFixtures());

  app.post("/api/fixtures", async (request, reply) => {
    try {
      const parsed = fixtureInputSchema.parse(request.body);
      const fixture = await createFixtureAndSync(ctx, parsed);
      reply.code(201).send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.put("/api/fixtures/:id", async (request, reply) => {
    try {
      const parsed = fixtureUpdateSchema.parse(request.body);
      const fixture = await ctx.store.updateFixture((request.params as { id: string }).id, parsed);
      await ctx.homekit.syncFixtures(await ctx.store.listFixtures());
      ctx.broadcast({ type: "fixture_updated", data: fixture });
      reply.send(fixture);
    } catch (err) {
      handleError(err, reply);
    }
  });

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
