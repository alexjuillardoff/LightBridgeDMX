// Route (endpoint) HomeKit : expose en lecture l'etat du pont HomeKit
// (active ou non, code d'appairage, nombre d'accessoires, etc.).
import type { FastifyInstance } from "fastify";
import { RouteContext } from "./types";

// Enregistre l'endpoint GET /api/homekit qui renvoie le statut courant du pont.
export const registerHomeKitRoutes = (app: FastifyInstance, ctx: RouteContext) => {
  app.get("/api/homekit", async () => {
    return ctx.homekit.getStatus();
  });
};
