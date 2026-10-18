// Flux temps réel : ouverture du WebSocket (/ws dérivé de l'origine de la page),
// reconnexion automatique (backoff 1 s → 10 s) et dispatch des événements vers
// les stores. Au `open`, on recharge tout (refreshAll) : un backend redémarré
// peut avoir changé de patch, de scènes ou d'effets en cours.
import type { Fixture, RunningEffect, SmartLight, UniverseState, WsEvent } from "@lightbridgedmx/shared";
import { wsUrl } from "../lib/api";
import { pushLog, refreshAll, refreshScenes, setRunning, setWsStatus, upsertFixture, upsertSmartLight } from "./app";
import { applyTick } from "./universe";

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 10000;

/** Aiguille un événement serveur vers le bon store (exporté pour les tests). */
export function dispatchWsEvent(event: WsEvent): void {
  switch (event.type) {
    case "universe_tick":
      applyTick(event.data as UniverseState);
      break;
    case "fixture_updated":
      upsertFixture(event.data as Fixture);
      break;
    case "scene_activated": {
      // Le schéma partagé annonce une Scene ; une version du backend envoie { sceneId }.
      const data = event.data as { name?: string; sceneId?: string; id?: string };
      const label = data.name ?? data.sceneId ?? data.id ?? "?";
      pushLog({ level: "info", message: `Scène activée : ${label}`, timestamp: new Date().toISOString() });
      void refreshScenes().catch(() => undefined);
      break;
    }
    case "log":
      pushLog(event.data);
      break;
    case "smart_light_updated":
      upsertSmartLight(event.data as SmartLight);
      break;
    case "effects_updated":
      setRunning((event.data as { running: RunningEffect[] }).running ?? []);
      break;
    default:
      break;
  }
}

/**
 * Ouvre la connexion et la maintient. Renvoie la fonction d'arrêt (ferme la
 * socket, annule la reconnexion). Hors navigateur (pas de WebSocket) : no-op.
 */
export function startRealtime(): () => void {
  if (typeof WebSocket === "undefined") {
    setWsStatus("closed");
    return () => undefined;
  }

  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = (): void => {
    if (stopped || timer !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  };

  const connect = (): void => {
    if (stopped) return;
    setWsStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      setWsStatus("closed");
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      attempt = 0;
      setWsStatus("open");
      void refreshAll();
    };
    ws.onmessage = (ev: MessageEvent) => {
      let parsed: WsEvent;
      try {
        parsed = JSON.parse(String(ev.data)) as WsEvent;
      } catch {
        return;
      }
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") dispatchWsEvent(parsed);
    };
    ws.onerror = () => {
      /* onclose suit toujours une erreur : c'est lui qui replanifie */
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      setWsStatus("closed");
      scheduleReconnect();
    };
  };

  connect();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const ws = socket;
    socket = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    setWsStatus("closed");
  };
}
