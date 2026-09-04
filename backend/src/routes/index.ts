// Point d'enregistrement central des routes REST Fastify.
// Regroupe tous les modules de routes (systeme, projecteurs, scenes, presets...)
// et les branche en un seul appel depuis l'entree du serveur (index.ts).
import type { FastifyInstance } from "fastify";
import { registerDeviceRoutes } from "./devices";
import { registerEffectRoutes } from "./effects";
import { registerFixtureRoutes } from "./fixtures";
import { registerMerossRoutes } from "./meross";
import { registerPresetRoutes } from "./presets";
import { registerQxfRoutes } from "./qxf";
import { registerSceneRoutes } from "./scenes";
import { registerSmartLightRoutes } from "./smart-lights";
import { registerThreadLightRoutes } from "./thread-lights";
import { registerSystemRoutes } from "./system";
import { registerHomeKitRoutes } from "./homekit";
import { ErrorHandler, RouteContext } from "./types";
import { registerUniverseRoutes } from "./universe";

// Enregistre tous les groupes de routes sur l'instance Fastify.
// ctx : contexte partage (store, services...) injecte dans chaque handler.
// handleError : gestionnaire d'erreur commun pour des reponses HTTP coherentes.
// NB : systeme et HomeKit n'ont pas besoin de handleError (pas d'entree a valider cote client).
export const registerRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  registerSystemRoutes(app);
  registerHomeKitRoutes(app, ctx);
  registerFixtureRoutes(app, ctx, handleError);
  registerMerossRoutes(app, ctx, handleError);
  registerQxfRoutes(app, ctx, handleError);
  registerSceneRoutes(app, ctx, handleError);
  registerPresetRoutes(app, ctx, handleError);
  registerUniverseRoutes(app, ctx, handleError);
  registerSmartLightRoutes(app, ctx, handleError);
  registerDeviceRoutes(app, ctx, handleError);
  registerThreadLightRoutes(app, ctx, handleError);
  registerEffectRoutes(app, ctx);
};
