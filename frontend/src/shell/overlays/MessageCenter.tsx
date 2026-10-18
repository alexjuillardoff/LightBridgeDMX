// Overlay « Message Center » (enveloppe) : journal des 200 derniers messages (info / warn /
// error) ; l'ouverture marque tout comme lu.
import { useEffect } from "react";
import { markLogsRead, useLogs } from "../../state/app";
import { closeOverlay } from "../../state/workspace";
import { OverlayFrame } from "./OverlayFrame";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("fr-FR", { hour12: false });
}

export function MessageCenter() {
  const logs = useLogs();
  useEffect(() => {
    markLogsRead();
  }, [logs.length]);

  return (
    <OverlayFrame title="Message Center" onClose={closeOverlay} width={50} top>
      {logs.length === 0 ? <div className="ma-empty">Aucun message.</div> : null}
      <ul className="sh-msgs">
        {logs
          .slice()
          .reverse()
          .map((l, i) => (
            <li key={`${l.timestamp}-${i}`} className={`sh-msgs__row is-${l.level}`}>
              <span className="sh-msgs__time ma-mono">{formatTime(l.timestamp)}</span>
              <span className="sh-msgs__level">{l.level === "error" ? "Erreur" : l.level === "warn" ? "Alerte" : "Info"}</span>
              <span className="sh-msgs__text">{l.message}</span>
            </li>
          ))}
      </ul>
    </OverlayFrame>
  );
}
