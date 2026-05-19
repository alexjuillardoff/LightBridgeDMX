import { useEffect, useState } from "react";
import { Fixture, SmartLight, UniverseState, WsEvent } from "@lightbridgedmx/shared";
import { wsUrl } from "../lib/api";

type UseDmxWebsocketResult = {
  universeState: UniverseState | null;
  setUniverseState: React.Dispatch<React.SetStateAction<UniverseState | null>>;
  wsStatus: "connecting" | "open" | "closed";
  logMessage: string;
  setLogMessage: React.Dispatch<React.SetStateAction<string>>;
};

type WsHandlers = {
  onFixtureUpdated: (fixture: Fixture) => void;
  onSmartLightUpdated?: (light: SmartLight) => void;
};

export const useDmxWebsocket = (handlers: WsHandlers): UseDmxWebsocketResult => {
  const [universeState, setUniverseState] = useState<UniverseState | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [logMessage, setLogMessage] = useState<string>("");

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
            setLogMessage(`Scene activated: ${parsed.data.name}`);
            break;
          case "log":
            setLogMessage(parsed.data.message);
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
  }, [handlers]);

  return { universeState, setUniverseState, wsStatus, logMessage, setLogMessage };
};
