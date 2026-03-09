import type { FastifyInstance } from "fastify";

export const registerSystemRoutes = (app: FastifyInstance) => {
  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/ws", async (_, reply) => {
    reply.code(426).send({ message: "WebSocket upgrade required" });
  });
};
