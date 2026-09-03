// Routes (endpoints) de la prise connectee Meross.
//   GET  /api/meross       -> statut courant (etat, config, projecteurs surveilles)
//   PUT  /api/meross       -> met a jour la config (IP, device key, canal, activation)
//                             puis reconfigure le service a chaud
//   POST /api/meross/test  -> teste la connexion locale a la prise
//   GET  /api/meross/consumption -> historique de consommation journaliere (Wh/jour)
import type { FastifyInstance } from "fastify";
import { MerossConfigInputSchema } from "@lightbridgedmx/shared";
import { ErrorHandler, RouteContext } from "./types";

export const registerMerossRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  // Statut courant (lecture seule) pour l'UI Reglages.
  app.get("/api/meross", async () => ctx.meross.getStatus());

  // Mise a jour de la config : on persiste (singleton) puis on applique a chaud.
  app.put("/api/meross", async (request, reply) => {
    try {
      const patch = MerossConfigInputSchema.parse(request.body);
      const saved = await ctx.store.saveMerossConfig(patch);
      const status = await ctx.meross.reconfigure(saved);
      reply.send(status);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Historique de consommation journaliere lu dans la prise (mis en cache cote
  // service). Renvoie null si la prise est inactive ou sans metrologie.
  app.get("/api/meross/consumption", async () => ctx.meross.getConsumption());

  // Test de connexion : interroge la prise et renvoie joignabilite + etat on/off.
  app.post("/api/meross/test", async (_, reply) => {
    const result = await ctx.meross.testConnection();
    reply.send(result);
  });
};
