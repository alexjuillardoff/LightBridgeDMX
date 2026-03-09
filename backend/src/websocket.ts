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

export const createWebsocketManager = ({ logger, store, dmx }: WebsocketDeps) => {
  const wsClients = new Set<WebSocket>();
  const sendSafe = (socket: WebSocket, event: WsEvent) => {
    const payload = JSON.stringify(event);
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(payload);
    } catch (err) {
      logger.warn({ err }, "WebSocket send failed");
    }
  };

  const broadcast: Broadcast = (event) => {
    for (const client of wsClients) {
      sendSafe(client, event);
    }
  };

  const attach = (server: Server) => {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (socket: WebSocket) => {
      wsClients.add(socket);
      const now = new Date().toISOString();
      sendSafe(socket, { type: "universe_tick", data: dmx.getState() });
      store.listFixtures().forEach((fixture) => {
        sendSafe(socket, { type: "fixture_updated", data: fixture });
      });
      sendSafe(socket, { type: "log", data: { level: "info", message: "connected", timestamp: now } });

      socket.on("close", () => wsClients.delete(socket));
      socket.on("error", (err: unknown) => {
        logger.warn({ err }, "WebSocket client error");
        wsClients.delete(socket);
      });
    });
  };

  return { broadcast, attach };
};
