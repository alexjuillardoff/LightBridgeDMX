// Routes systeme : endpoints utilitaires de base du backend Fastify.
// Sert au healthcheck (sondes/monitoring) et au garde-fou WebSocket.
import type { FastifyInstance } from "fastify";

// Enregistre les routes systeme sur l'instance Fastify.
export const registerSystemRoutes = (app: FastifyInstance) => {
  // Sonde de sante : repond toujours "ok" si le backend tourne.
  app.get("/api/health", async () => ({ status: "ok" }));

  // /ws en HTTP simple n'a pas de sens : il faut une vraie negociation WebSocket.
  // On renvoie 426 (Upgrade Required) pour le signaler clairement au client.
  app.get("/ws", async (_, reply) => {
    reply.code(426).send({ message: "WebSocket upgrade required" });
  });
};
