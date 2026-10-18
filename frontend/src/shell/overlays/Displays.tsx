// Overlay « Displays » : Display 1 (actif, jaune), 2 à 7 grisés — LightBridgeDMX n'a qu'un écran.
import { closeOverlay } from "../../state/workspace";
import { IconDisplay } from "../icons";
import { OverlayFrame } from "./OverlayFrame";

export function Displays() {
  return (
    <OverlayFrame title="Displays" onClose={closeOverlay} width={40}>
      <div className="sh-displays">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            type="button"
            className={`ma-btn sh-displays__tile${n === 1 ? " ma-btn--active" : " ma-btn--disabled"}`}
            disabled={n !== 1}
            onClick={closeOverlay}
            aria-pressed={n === 1}
          >
            <IconDisplay />
            <span>{`Display ${n}`}</span>
          </button>
        ))}
      </div>
      <p className="ma-dialog__text">Une seule display : l'interface tient dans cette fenêtre de navigateur.</p>
    </OverlayFrame>
  );
}
