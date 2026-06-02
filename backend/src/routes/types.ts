// Types partages par les routes (endpoints) REST Fastify.
// Definit le "contexte" injecte dans chaque gestionnaire (handler) de route :
// il regroupe tous les services dont une route peut avoir besoin (store,
// DMX, pont HomeKit, mode Dance, lampes connectees) plus la fonction de
// diffusion (broadcast) WebSocket.

import type { FastifyReply } from "fastify";
import { WsEvent } from "@lightbridgedmx/shared";
import { DmxService } from "../services/dmx";
import { HomeKitBridge } from "../services/homekit";
import { DanceService } from "../services/dance";
import { SmartLightService } from "../services/smart-lights";
import { Store } from "../state/store";

// Envoie un evenement a tous les clients WebSocket connectes (diffusion/broadcast).
export type Broadcast = (event: WsEvent) => void;

// Sac de dependances passe a chaque route : evite de recreer les services
// dans chaque endpoint et garde une source unique pour l'etat partage.
export type RouteContext = {
  store: Store;
  dmx: DmxService;
  homekit: HomeKitBridge;
  dance: DanceService;
  smartLights: SmartLightService;
  broadcast: Broadcast;
};

// Gestionnaire (handler) d'erreur commun : convertit une erreur attrapee
// en reponse HTTP propre via la reply Fastify.
export type ErrorHandler = (err: unknown, reply: FastifyReply) => void;
