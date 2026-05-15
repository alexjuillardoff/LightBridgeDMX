import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DancePatternIdSchema, CapabilitySchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

export const registerDanceRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const updateBodySchema = z.object({
    rooms: z.array(z.string().min(1)).optional(),
    intervalMinMs: z.number().int().min(1).max(2000).optional(),
    intervalMaxMs: z.number().int().min(1).max(2000).optional(),
    patterns: z.array(DancePatternIdSchema).optional(),
    excludePanTilt: z.boolean().optional(),
    excludeCapabilities: z.array(CapabilitySchema).optional(),
    lyre: z
      .object({
        enabled: z.boolean(),
        shutterOpenValue: z.number().int().min(0).max(255),
        dimmerOnValue: z.number().int().min(0).max(255),
        followChase: z.boolean(),
        positions: z.array(
          z.object({
            fixtureId: z.string().uuid(),
            pan: z.number().int().min(0).max(255),
            tilt: z.number().int().min(0).max(255)
          })
        ),
        wallEdgeRight: z
          .object({
            pan: z.number().int().min(0).max(255),
            tilt: z.number().int().min(0).max(255)
          })
          .nullable(),
        speedValue: z.number().int().min(0).max(255),
        msPerPanUnit: z.number().int().min(1).max(500)
      })
      .optional()
  });

  app.get("/api/dance/state", async (_request, reply) => {
    try {
      const state = await ctx.dance.getState();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.put("/api/dance/config", async (request, reply) => {
    try {
      const parsed = updateBodySchema.parse(request.body ?? {});
      const state = await ctx.dance.updateConfig(parsed);
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/dance/start", async (_request, reply) => {
    try {
      const state = await ctx.dance.start();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/dance/stop", async (_request, reply) => {
    try {
      const state = await ctx.dance.stop();
      reply.send(state);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get("/api/rooms", async (_request, reply) => {
    try {
      const rooms = await ctx.store.listRooms();
      reply.send(rooms);
    } catch (err) {
      handleError(err, reply);
    }
  });
};
