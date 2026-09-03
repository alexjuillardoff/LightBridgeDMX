// Route (endpoint) "Appareils" : inventaire unifie de tout ce que LightBridge
// voit sur le reseau, pilotable ou non.
//
// Deux endpoints, parce que le scan mDNS coute plusieurs secondes :
//   GET  /api/devices       -> reponse immediate, servie depuis le dernier scan
//   POST /api/devices/scan  -> relance un scan puis renvoie l'inventaire a jour
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DeviceInventory } from "@lightbridgedmx/shared";
import { buildInventory } from "../services/discovery/inventory";
import { NetworkScanner } from "../services/discovery/network-scan";
import { ErrorHandler, RouteContext } from "./types";

export const registerDeviceRoutes = (
  app: FastifyInstance,
  ctx: RouteContext,
  handleError: ErrorHandler
) => {
  // Un seul scanner pour toute la duree de vie du serveur : c'est lui qui porte
  // le cache mDNS partage entre les deux endpoints.
  const scanner = new NetworkScanner(app.log);

  /** Rassemble les sources et construit l'inventaire a partir du cache mDNS courant. */
  const collect = async (): Promise<DeviceInventory> => {
    const { devices: mdns, scannedAt } = scanner.getCache();
    const homekit = ctx.homekit.getStatus();
    return {
      devices: buildInventory({
        fixtures: await ctx.store.listFixtures(),
        lights: ctx.smartLights.listWithState(),
        meross: ctx.meross.getStatus(),
        // Un pont arrete ne s'annonce pas en mDNS : inutile de chercher a l'identifier.
        homekitName: homekit.started ? homekit.name : null,
        mdns
      }),
      scannedAt
    };
  };

  app.get("/api/devices", async (_request, reply) => {
    try {
      reply.send(await collect());
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post("/api/devices/scan", async (request, reply) => {
    try {
      const parsed = z
        .object({ timeoutMs: z.number().int().min(500).max(10000).optional() })
        .parse(request.body ?? {});
      await scanner.scan(parsed.timeoutMs ?? 6000);
      reply.send(await collect());
    } catch (err) {
      handleError(err, reply);
    }
  });
};
