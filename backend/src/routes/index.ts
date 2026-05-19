import type { FastifyInstance } from "fastify";
import { registerDanceRoutes } from "./dance";
import { registerFixtureRoutes } from "./fixtures";
import { registerPresetRoutes } from "./presets";
import { registerQxfRoutes } from "./qxf";
import { registerSceneRoutes } from "./scenes";
import { registerSmartLightRoutes } from "./smart-lights";
import { registerSystemRoutes } from "./system";
import { registerHomeKitRoutes } from "./homekit";
import { ErrorHandler, RouteContext } from "./types";
import { registerUniverseRoutes } from "./universe";

export const registerRoutes = (app: FastifyInstance, ctx: RouteContext, handleError: ErrorHandler) => {
  registerSystemRoutes(app);
  registerHomeKitRoutes(app, ctx);
  registerFixtureRoutes(app, ctx, handleError);
  registerQxfRoutes(app, ctx, handleError);
  registerSceneRoutes(app, ctx, handleError);
  registerPresetRoutes(app, ctx, handleError);
  registerUniverseRoutes(app, ctx, handleError);
  registerDanceRoutes(app, ctx, handleError);
  registerSmartLightRoutes(app, ctx, handleError);
};
