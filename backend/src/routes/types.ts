import type { FastifyReply } from "fastify";
import { WsEvent } from "@lightbridgedmx/shared";
import { DmxService } from "../services/dmx";
import { HomeKitBridge } from "../services/homekit";
import { Store } from "../state/store";

export type Broadcast = (event: WsEvent) => void;

export type RouteContext = {
  store: Store;
  dmx: DmxService;
  homekit: HomeKitBridge;
  broadcast: Broadcast;
};

export type ErrorHandler = (err: unknown, reply: FastifyReply) => void;
