// En-tete de l'application : titre, sous-titre et badge d'etat de la connexion
// WebSocket (WS) vers le backend. Le badge change de couleur selon l'etat.
import { Zap } from "lucide-react";

// wsBadge : texte d'etat de la connexion WebSocket ("Connected", "Connecting", ...).
type HeaderProps = {
  wsBadge: string;
};

export const Header = ({ wsBadge }: HeaderProps) => {
  // Choix de la classe CSS de couleur du badge selon l'etat WS :
  // vert (badge-on) si connecte, neutre pendant la connexion, rouge (badge-off) sinon.
  const tone =
    wsBadge === "Connected" ? "badge-on" : wsBadge === "Connecting" ? "" : "badge-off";
  return (
    <header className="header">
      <div className="title">
        <div className="title-row">
          <span className="title-icon" aria-hidden="true">
            <Zap size={22} strokeWidth={2.2} />
          </span>
          <h1>LightBridgeDMX</h1>
        </div>
        <p>Pont DMX512 ↔ Apple HomeKit · contrôle, monitoring et lampes connectées</p>
      </div>
      <div className="header-status">
        <span className={`badge ${tone}`}>WS · {wsBadge}</span>
      </div>
    </header>
  );
};
