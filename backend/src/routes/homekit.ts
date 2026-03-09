import type { FastifyInstance } from "fastify";
import { RouteContext } from "./types";

export const registerHomeKitRoutes = (app: FastifyInstance, ctx: RouteContext) => {
  app.get("/api/homekit", async () => {
    return ctx.homekit.getStatus();
  });
};
