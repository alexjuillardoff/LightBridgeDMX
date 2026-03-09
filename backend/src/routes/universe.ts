import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErrorHandler, RouteContext } from "./types";

export const registerUniverseRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const testBodySchema = z.object({ values: z.array(z.number().int().min(0).max(255)).min(1) });
  const channelBodySchema = z.object({ value: z.number().int().min(0).max(255) });

  app.post("/api/test/fixtures/:id", async (request, reply) => {
    try {
      const parsed = testBodySchema.parse(request.body);
      const fixture = await ctx.store.getFixture((request.params as { id: string }).id);
      if (!fixture) return reply.code(404).send({ message: "Fixture not found" });

      ctx.dmx.applyWrite({ address: fixture.address, values: parsed.values });
      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/universe/:channel", async (request, reply) => {
    try {
      const channel = Number((request.params as { channel: string }).channel);
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
