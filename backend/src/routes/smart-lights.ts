import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SmartLight,
  SmartLightEffectConfigSchema,
  SmartLightInputSchema,
  SmartLightPairInputSchema,
  SmartLightStateInputSchema,
  SmartLightZoneLayoutSchema,
  SmartLightZonePaletteSchema
} from "@lightbridgedmx/shared";
import { NanoleafApiError, NanoleafClient } from "../services/smart-lights/nanoleaf-client";
import { discoverNanoleaf } from "../services/smart-lights/discovery";
import { ErrorHandler, RouteContext } from "./types";

export const registerSmartLightRoutes = (
  app: FastifyInstance,
  ctx: RouteContext,
  handleError: ErrorHandler
) => {
  app.get("/api/smart-lights", async () => ctx.smartLights.listWithState());

  app.get("/api/smart-lights/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const light = ctx.smartLights.getWithState(id);
    if (!light) return reply.code(404).send({ message: "Smart light not found" });
    return light;
  });

  app.post("/api/smart-lights", async (request, reply) => {
    try {
      const parsed = SmartLightInputSchema.parse(request.body);
      const light = await ctx.store.createSmartLight(parsed);
      await ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.code(201).send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.put("/api/smart-lights/:id", async (request, reply) => {
    try {
      const parsed = SmartLightInputSchema.partial().parse(request.body);
      const id = (request.params as { id: string }).id;
      const light = await ctx.store.updateSmartLight(id, parsed);
      await ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.delete("/api/smart-lights/:id", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      await ctx.store.deleteSmartLight(id);
      await ctx.smartLights.unregister(id);
      reply.code(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  /** Apply state — low-latency path: coalesced and pushed by the service tick. */
  app.post("/api/smart-lights/:id/state", async (request, reply) => {
    try {
      const parsed = SmartLightStateInputSchema.parse(request.body);
      const id = (request.params as { id: string }).id;
      const light = ctx.smartLights.applyState(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  /**
   * Pair a Nanoleaf device. The user must put the strip into pairing mode first
   * (hold power button ~5–7s until the LED pulses). On success the auth token is
   * persisted into the smart light config and the runtime client picks it up.
   *
   * Two modes:
   *   • POST /api/smart-lights/pair          → creates a brand-new smart light entry
   *   • POST /api/smart-lights/:id/pair     → re-pairs an existing entry (refresh token)
   */
  app.post("/api/smart-lights/pair", async (request, reply) => {
    try {
      const parsed = SmartLightPairInputSchema.parse(request.body);
      const token = await NanoleafClient.pair(parsed.host, parsed.port, app.log);

      // Fetch device name/model for nicer defaults.
      const probeClient = new NanoleafClient({
        host: parsed.host,
        port: parsed.port,
        token,
        logger: app.log
      });
      let deviceName = parsed.name;
      try {
        const info = await probeClient.getInfo();
        deviceName = deviceName ?? info.name;
      } catch {
        // Non-fatal: keep going with whatever name the user supplied.
      }

      const light = await ctx.store.createSmartLight({
        name: deviceName ?? `Nanoleaf ${parsed.host}`,
        backend: "nanoleaf-http",
        ...(parsed.room ? { room: parsed.room } : {}),
        config: {
          type: "nanoleaf-http",
          host: parsed.host,
          ...(parsed.port ? { port: parsed.port } : {}),
          token,
          ...(deviceName ? { deviceName } : {})
        }
      });
      ctx.smartLights.register(light);
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.code(201).send(light);
    } catch (err) {
      if (err instanceof NanoleafApiError) {
        return reply.code(err.status === 403 ? 409 : err.status).send({ message: err.message });
      }
      handleError(err, reply);
    }
  });

  app.post("/api/smart-lights/:id/pair", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const existing = await ctx.store.getSmartLight(id);
      if (!existing) return reply.code(404).send({ message: "Smart light not found" });
      if (existing.config.type !== "nanoleaf-http") {
        return reply.code(400).send({ message: "Only nanoleaf-http re-pair is supported" });
      }
      const token = await NanoleafClient.pair(existing.config.host, existing.config.port, app.log);
      const updated = await ctx.store.updateSmartLight(id, {
        config: { ...existing.config, token } as SmartLight["config"]
      });
      await ctx.smartLights.register(updated);
      ctx.broadcast({ type: "smart_light_updated", data: updated });
      reply.send(updated);
    } catch (err) {
      if (err instanceof NanoleafApiError) {
        return reply.code(err.status === 403 ? 409 : err.status).send({ message: err.message });
      }
      handleError(err, reply);
    }
  });

  // ─── Effects ──────────────────────────────────────────────────────────────

  app.get("/api/smart-lights/:id/effects", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const effects = await ctx.smartLights.listEffects(id);
      reply.send({ effects });
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/smart-lights/:id/effects/select", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = z.object({ name: z.string().min(1) }).parse(request.body);
      const light = await ctx.smartLights.selectEffect(id, parsed.name);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Streaming (UDP extControl) ──────────────────────────────────────────

  app.post("/api/smart-lights/:id/streaming", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = z
        .object({ enabled: z.boolean(), zoneCount: z.number().int().min(1).max(500).optional() })
        .parse(request.body);
      const light = await ctx.smartLights.setStreaming(id, parsed.enabled, parsed.zoneCount);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Per-zone palette (requires streaming.enabled = true) ─────────────────

  app.post("/api/smart-lights/:id/zones", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightZonePaletteSchema.parse(request.body);
      const light = ctx.smartLights.applyZones(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── 3D Zone Layout ──────────────────────────────────────────────────────

  app.post("/api/smart-lights/:id/layout", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightZoneLayoutSchema.nullable().parse(request.body);
      const light = await ctx.smartLights.setLayout(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Active position-aware Effect ────────────────────────────────────────

  app.post("/api/smart-lights/:id/effect", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const parsed = SmartLightEffectConfigSchema.nullable().parse(request.body);
      const light = await ctx.smartLights.setEffect(id, parsed);
      if (!light) return reply.code(404).send({ message: "Smart light not found" });
      ctx.broadcast({ type: "smart_light_updated", data: light });
      reply.send(light);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ─── Discovery (mDNS) ────────────────────────────────────────────────────

  app.post("/api/smart-lights/discover", async (request, reply) => {
    try {
      const parsed = z
        .object({ timeoutMs: z.number().int().min(500).max(10000).optional() })
        .parse(request.body ?? {});
      const devices = await discoverNanoleaf(parsed.timeoutMs ?? 3000, app.log);
      reply.send({ devices });
    } catch (err) {
      handleError(err, reply);
    }
  });

  /** Quick reachability probe — returns whether the Nanoleaf HTTP API is responding. */
  app.post("/api/smart-lights/probe", async (request, reply) => {
    try {
      const parsed = z.object({ host: z.string().min(1), port: z.number().int().optional() }).parse(request.body);
      const port = parsed.port ?? 16021;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`http://${parsed.host}:${port}/api/v1/new`, {
          method: "POST",
          signal: ctrl.signal
        });
        reply.send({
          reachable: true,
          // 403 = API alive but not in pairing mode (most common); 200 = pairing succeeded
          inPairingMode: res.status === 200,
          status: res.status
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      reply.send({ reachable: false, inPairingMode: false });
    }
  });
};
