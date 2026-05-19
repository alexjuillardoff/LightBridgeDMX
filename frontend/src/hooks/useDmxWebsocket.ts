import { useCallback, useEffect, useState } from "react";
import { Fixture, SmartLight, UniverseState, WsEvent } from "@lightbridgedmx/shared";
import { wsUrl } from "../lib/api";

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

type WsHandlers = {
  onFixtureUpdated: (fixture: Fixture) => void;
  onSmartLightUpdated?: (light: SmartLight) => void;
};

const LOG_HISTORY_MAX = 10;

export const useDmxWebsocket = (handlers: WsHandlers): UseDmxWebsocketResult => {
  const [universeState, setUniverseState] = useState<UniverseState | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [logMessage, setLogMessage] = useState<string>("");
  const [logHistory, setLogHistory] = useState<LogEntry[]>([]);

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

  useEffect(() => {
    const socket = new WebSocket(wsUrl());

    socket.onopen = () => setWsStatus("open");
    socket.onclose = () => setWsStatus("closed");
    socket.onerror = () => setWsStatus("closed");
    socket.onmessage = (event) => {
      try {
        const parsed: WsEvent = JSON.parse(event.data);
        switch (parsed.type) {
          case "universe_tick":
            setUniverseState(parsed.data);
            break;
          case "fixture_updated":
            handlers.onFixtureUpdated(parsed.data);
            break;
          case "scene_activated":
            pushLog("info", `Scene activated: ${parsed.data.name}`);
            break;
          case "log":
            pushLog(parsed.data.level, parsed.data.message, parsed.data.timestamp);
            break;
          case "smart_light_updated":
            handlers.onSmartLightUpdated?.(parsed.data);
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    return () => socket.close();
  }, [handlers, pushLog]);

  return { universeState, setUniverseState, wsStatus, logMessage, setLogMessage, logHistory };
};
