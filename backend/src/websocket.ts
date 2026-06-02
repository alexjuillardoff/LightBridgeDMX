// Gestionnaire WebSocket du backend.
// Maintient l'ensemble des clients connectes sur /ws et leur diffuse (broadcast)
// les evenements temps reel : etat des canaux DMX (universe_tick), mises a jour
// de projecteurs (fixture_updated) et logs. Utilise le package "ws" natif
// (diffusion manuelle), pas Socket.io.
import { Server } from "node:http";
import type { FastifyBaseLogger } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { WsEvent } from "@lightbridgedmx/shared";
import { Broadcast } from "./routes/types";
import { DmxService } from "./services/dmx";
import { Store } from "./state/store";

type WebsocketDeps = {
  logger: FastifyBaseLogger;
  store: Store;
  dmx: DmxService;
};

// Cree le gestionnaire WebSocket et renvoie { broadcast, attach }.
// broadcast : envoie un evenement a tous les clients ; attach : branche le
// serveur WS sur le serveur HTTP existant.
export const createWebsocketManager = ({ logger, store, dmx }: WebsocketDeps) => {
  // Ensemble des sockets actuellement connectees.
  const wsClients = new Set<WebSocket>();

  // Envoi protege vers une socket unique.
  // On verifie que la socket est OPEN et on capture toute erreur d'envoi pour
  // qu'un client casse ne fasse pas planter la diffusion vers les autres.
  const sendSafe = (socket: WebSocket, event: WsEvent) => {
    const payload = JSON.stringify(event);
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(payload);
    } catch (err) {
      logger.warn({ err }, "WebSocket send failed");
    }
  };

  // Diffuse un evenement a tous les clients connectes.
  const broadcast: Broadcast = (event) => {
    for (const client of wsClients) {
      sendSafe(client, event);
    }
  };

  // Branche le serveur WebSocket sur le serveur HTTP, ecoute sur le chemin /ws.
  const attach = (server: Server) => {
    const wss = new WebSocketServer({ server, path: "/ws" });
    // A chaque nouvelle connexion : on enregistre le client puis on lui envoie
    // un "etat initial" pour qu'il soit a jour sans attendre le prochain tick :
    //  1) l'instantane des canaux DMX, 2) tous les projecteurs connus, 3) un log.
    wss.on("connection", async (socket: WebSocket) => {
      wsClients.add(socket);
      const now = new Date().toISOString();
      sendSafe(socket, { type: "universe_tick", data: dmx.getState() });
      const fixtures = await store.listFixtures();
      fixtures.forEach((fixture) => {
        sendSafe(socket, { type: "fixture_updated", data: fixture });
      });
      sendSafe(socket, { type: "log", data: { level: "info", message: "connected", timestamp: now } });

      // On retire le client de l'ensemble a la fermeture ou en cas d'erreur,
      // pour ne pas diffuser vers des sockets mortes.
      socket.on("close", () => wsClients.delete(socket));
      socket.on("error", (err: unknown) => {
        logger.warn({ err }, "WebSocket client error");
        wsClients.delete(socket);
      });
    });
  };

  return { broadcast, attach };
};
