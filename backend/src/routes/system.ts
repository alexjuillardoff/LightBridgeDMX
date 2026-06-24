// Routes systeme : endpoints utilitaires de base du backend Fastify.
// Sert au healthcheck (sondes/monitoring), au garde-fou WebSocket et au redemarrage
// complet de LightBridgeDMX (backend + frontend + QLC+) via launchd.
import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";

// Les 3 services launchd de LightBridgeDMX (voir ~/Library/LaunchAgents).
// On relance le backend EN DERNIER : il se tue lui-meme via kickstart -k, donc on
// laisse d'abord redemarrer les deux autres.
const RESTART_LABELS = [
  "com.lightbridgedmx.frontend.dev",
  "com.lightbridgedmx.qlcplus",
  "com.lightbridgedmx.backend.dev"
];

// Enregistre les routes systeme sur l'instance Fastify.
export const registerSystemRoutes = (app: FastifyInstance) => {
  // Sonde de sante : repond toujours "ok" si le backend tourne.
  app.get("/api/health", async () => ({ status: "ok" }));

  // /ws en HTTP simple n'a pas de sens : il faut une vraie negociation WebSocket.
  // On renvoie 426 (Upgrade Required) pour le signaler clairement au client.
  app.get("/ws", async (_, reply) => {
    reply.code(426).send({ message: "WebSocket upgrade required" });
  });

  // Redemarre tout LightBridgeDMX avec la config a jour. On lance un processus
  // DETACHE qui attend ~1s (le temps de renvoyer la reponse) puis relance les 3
  // services via launchctl kickstart -k (kill + restart). Detache + unref pour
  // survivre a sa propre mort quand le backend se fait relancer.
  app.post("/api/system/restart", async (_, reply) => {
    if (process.platform !== "darwin") {
      reply.code(501).send({ message: "Redémarrage supporté uniquement sur macOS (launchd)" });
      return;
    }
    const uid = process.getuid?.() ?? 0;
    const cmds = RESTART_LABELS.map((label) => `launchctl kickstart -k gui/${uid}/${label}`).join("; ");
    const child = spawn("sh", ["-c", `sleep 1; ${cmds}`], { detached: true, stdio: "ignore" });
    child.unref();
    reply.code(202).send({ status: "restarting", services: RESTART_LABELS });
  });
};
