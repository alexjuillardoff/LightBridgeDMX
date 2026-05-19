import { Zap } from "lucide-react";

type HeaderProps = {
  wsBadge: string;
};

export const Header = ({ wsBadge }: HeaderProps) => {
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
