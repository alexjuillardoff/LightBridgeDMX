// Hook React : ouvre la connexion WebSocket vers le backend et ecoute ses evenements.
// Il maintient l'etat de l'univers DMX en direct (universe_tick), relaie les mises
// a jour de projecteurs (fixtures) et de lampes connectees (smart lights) aux
// gestionnaires fournis, et garde un petit historique des derniers messages de log.
import { useCallback, useEffect, useState } from "react";
import { Fixture, SmartLight, UniverseState, WsEvent } from "@lightbridgedmx/shared";
import { wsUrl } from "../lib/api";

// Une ligne de l'historique de log affiche dans l'UI.
export type LogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
};

type UseDmxWebsocketResult = {
  universeState: UniverseState | null;
  setUniverseState: React.Dispatch<React.SetStateAction<UniverseState | null>>;
  wsStatus: "connecting" | "open" | "closed";
  logMessage: string;
  setLogMessage: React.Dispatch<React.SetStateAction<string>>;
  logHistory: LogEntry[];
};

// Callbacks que le composant parent fournit pour reagir aux evenements WebSocket.
type WsHandlers = {
  onFixtureUpdated: (fixture: Fixture) => void;
  onSmartLightUpdated?: (light: SmartLight) => void;
};

// On ne conserve que les 10 derniers logs pour ne pas faire grossir la memoire.
const LOG_HISTORY_MAX = 10;

export const useDmxWebsocket = (handlers: WsHandlers): UseDmxWebsocketResult => {
  const [universeState, setUniverseState] = useState<UniverseState | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [logMessage, setLogMessage] = useState<string>("");
  const [logHistory, setLogHistory] = useState<LogEntry[]>([]);

  // Ajoute un log : met a jour le dernier message et empile en tete de l'historique.
  // On garde le plus recent en premier et on tronque a LOG_HISTORY_MAX entrees.
  const pushLog = useCallback(
    (level: LogEntry["level"], message: string, timestamp = new Date().toISOString()) => {
      setLogMessage(message);
      setLogHistory((prev) => {
        const next = [{ level, message, timestamp }, ...prev];
        return next.slice(0, LOG_HISTORY_MAX);
      });
    },
    []
  );

  // Ouvre la connexion WebSocket et branche les ecouteurs.
  // La fonction de nettoyage ferme la socket quand le composant se demonte
  // ou quand les dependances changent (evite les connexions fantomes).
  useEffect(() => {
    const socket = new WebSocket(wsUrl());

    socket.onopen = () => setWsStatus("open");
    socket.onclose = () => setWsStatus("closed");
    socket.onerror = () => setWsStatus("closed");
    // Chaque message entrant est un WsEvent JSON ; on aiguille selon son type.
    socket.onmessage = (event) => {
      try {
        const parsed: WsEvent = JSON.parse(event.data);
        switch (parsed.type) {
          // tick (battement) de la boucle DMX : etat complet des 512 canaux.
          case "universe_tick":
            setUniverseState(parsed.data);
            break;
          // Un projecteur a change : on previent le parent pour rafraichir l'UI.
          case "fixture_updated":
            handlers.onFixtureUpdated(parsed.data);
            break;
          // Une scene a ete activee : on l'inscrit simplement dans le log.
          case "scene_activated":
            pushLog("info", `Scene activated: ${parsed.data.name}`);
            break;
          // Message de log emis par le backend.
          case "log":
            pushLog(parsed.data.level, parsed.data.message, parsed.data.timestamp);
            break;
          // Une lampe connectee a change : relai optionnel vers le parent.
          case "smart_light_updated":
            handlers.onSmartLightUpdated?.(parsed.data);
            break;
          default:
            break;
        }
      } catch (err) {
        // Message non-JSON ou inattendu : on log l'erreur sans casser la socket.
        console.error("WS parse error", err);
      }
    };

    // Nettoyage : ferme la socket a la fin de vie de l'effet.
    return () => socket.close();
  }, [handlers, pushLog]);

  return { universeState, setUniverseState, wsStatus, logMessage, setLogMessage, logHistory };
};
