// Barre d'etat superieure du pupitre.
// Reprend la logique de la "status bar" d'un grandMA : marque a gauche, series
// d'afficheurs encastres au centre (sortie DMX, canaux actifs, projecteurs,
// selection, HomeKit), horloge et bouton Blackout a droite.
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { useAppData } from "../contexts/AppDataContext";
import { useSelection } from "../contexts/SelectionContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { countActiveChannels } from "../lib/fixtures";

// Petit afficheur encastre : un libelle en capitales, une valeur en monospace.
const Readout = ({
  label,
  value,
  tone = "text",
  className = ""
}: {
  label: string;
  value: string;
  tone?: "text" | "blue" | "ok" | "warn" | "off";
  // Classe supplémentaire, pour cibler un afficheur en CSS (ex. masquer
  // l'horloge sur mobile).
  className?: string;
}) => {
  const toneClass =
    tone === "blue"
      ? ""
      : tone === "ok"
      ? "ma-readout-value-ok"
      : tone === "warn"
      ? "ma-readout-value-warn"
      : tone === "off"
      ? "ma-readout-value-off"
      : "ma-readout-value-text";
  return (
    <div className={`ma-readout ${className}`}>
      <span className="ma-readout-label">{label}</span>
      <span className={`ma-readout-value ${toneClass}`}>{value}</span>
    </div>
  );
};

export const StatusBar = () => {
  const { fixtures, homekitStatus, wsStatus, handleBlackout } = useAppData();
  const { universeState } = useUniverseState();
  const { selectedIds } = useSelection();

  // Horloge du pupitre : rafraichie chaque seconde.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeChannels = countActiveChannels(universeState);
  const fps = universeState?.fps ?? 0;
  // Le lien DMX est considere vivant tant que le backend pousse des trames.
  const dmxLive = Boolean(universeState) && wsStatus === "open";
  const homekitOn = Boolean(homekitStatus?.enabled && homekitStatus?.started);

  return (
    <header className="ma-statusbar">
      <div className="ma-brand">
        <span className="ma-brand-mark" aria-hidden="true">
          <Zap size={15} strokeWidth={2.4} />
        </span>
        <span className="ma-brand-text">
          <span className="ma-brand-title">LightBridge</span>
          <span className="ma-brand-sub">DMX Console</span>
        </span>
      </div>

      <div className="ma-status-group">
        <Readout className="ma-readout-secondary" label="Univers" value="01" />
        <Readout label="Sortie" value={dmxLive ? `${fps} fps` : "hors ligne"} tone={dmxLive ? "ok" : "off"} />
        <Readout className="ma-readout-secondary" label="Canaux" value={`${activeChannels} / 512`} tone="blue" />
        <Readout
          className="ma-readout-secondary"
          label="Projecteurs"
          value={String(fixtures.length).padStart(2, "0")}
        />
        <Readout
          label="Sélection"
          value={selectedIds.length ? String(selectedIds.length).padStart(2, "0") : "—"}
          tone={selectedIds.length ? "warn" : "text"}
        />
        <span
          className={`ma-led ${
            wsStatus === "open" ? "ma-led-on" : wsStatus === "connecting" ? "ma-led-warn" : "ma-led-off"
          }`}
        >
          Link
        </span>
        <span className={`ma-led ${homekitOn ? "ma-led-on" : homekitStatus?.enabled ? "ma-led-warn" : ""}`}>
          HomeKit
        </span>
      </div>

      <div className="ma-status-right">
        <Readout
          className="ma-readout-clock"
          label={now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
          value={now.toLocaleTimeString("fr-FR")}
          tone="blue"
        />
        {/* Blackout : remise a zero immediate des 512 canaux, comme la touche
            dediee d'un pupitre. */}
        <button type="button" className="btn-danger" onClick={() => void handleBlackout()}>
          Blackout
        </button>
      </div>
    </header>
  );
};
