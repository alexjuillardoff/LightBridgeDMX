import { useEffect, useState } from "react";
import { Fixture, UniverseState, WsEvent } from "@lightbridgedmx/shared";
import { wsUrl } from "../lib/api";

type UseDmxWebsocketResult = {
  universeState: UniverseState | null;
  setUniverseState: React.Dispatch<React.SetStateAction<UniverseState | null>>;
  wsStatus: "connecting" | "open" | "closed";
  logMessage: string;
  setLogMessage: React.Dispatch<React.SetStateAction<string>>;
};

export const useDmxWebsocket = (onFixtureUpdated: (fixture: Fixture) => void): UseDmxWebsocketResult => {
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
            onFixtureUpdated(parsed.data);
            break;
          case "scene_activated":
            setLogMessage(`Scene activated: ${parsed.data.name}`);
            break;
          case "log":
            setLogMessage(parsed.data.message);
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    return () => socket.close();
  }, [onFixtureUpdated]);

  return { universeState, setUniverseState, wsStatus, logMessage, setLogMessage };
};
