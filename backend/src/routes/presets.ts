import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PresetSchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

export const registerPresetRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  const presetInputSchema = PresetSchema.omit({ id: true }).extend({
    id: z.string().uuid().optional()
  });

  app.get("/api/presets", async () => ctx.store.listPresets());

  app.post("/api/presets", async (request, reply) => {
    try {
      const parsed = presetInputSchema.parse(request.body);
      const preset = ctx.store.createPreset(parsed);
      reply.code(201).send(preset);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/presets/:id/apply", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const preset = ctx.store.listPresets().find((p) => p.id === id);
      if (!preset) return reply.code(404).send({ message: "Preset not found" });

      Object.entries(preset.payload).forEach(([channelStr, value]) => {
        const channel = Number(channelStr);
        ctx.dmx.setChannel(channel, value);
      });

      reply.send({ ok: true });
    } catch (err) {
      handleError(err, reply);
    }
  });
};
