// Overlay « Shutdown » (bouton Power) : Reload UI, Restart LightBridgeDMX (avec confirmation).
import { useState } from "react";
import { closeOverlay } from "../../state/workspace";
import { restartSystem } from "../actions";
import { OverlayFrame } from "./OverlayFrame";

export function ShutdownMenu() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const restart = async () => {
    setBusy(true);
    const ok = await restartSystem();
    setBusy(false);
    if (ok) {
      closeOverlay();
      // Les services launchd reviennent en quelques secondes : on recharge ensuite.
      window.setTimeout(() => window.location.reload(), 8000);
    }
  };

  return (
    <OverlayFrame title="Shutdown" onClose={closeOverlay} width={24}>
      {confirm ? (
        <>
          <p className="ma-dialog__text">
            Redémarrer les services LightBridgeDMX (backend, interface, QLC+) ? La sortie DMX sera interrompue quelques secondes et
            les accessoires HomeKit se reconnecteront.
          </p>
          <div className="ma-row">
            <button type="button" className="ma-btn ma-btn--danger ma-btn--wide" disabled={busy} onClick={() => void restart()}>
              {busy ? "Redémarrage…" : "Oui, redémarrer"}
            </button>
            <button type="button" className="ma-btn ma-btn--wide" disabled={busy} onClick={() => setConfirm(false)}>
              Non
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="ma-btn ma-btn--wide" onClick={() => window.location.reload()}>
            Reload UI
          </button>
          <button type="button" className="ma-btn ma-btn--wide ma-btn--danger" onClick={() => setConfirm(true)}>
            Restart LightBridgeDMX
          </button>
          <button type="button" className="ma-btn ma-btn--wide" onClick={closeOverlay}>
            Cancel
          </button>
        </>
      )}
    </OverlayFrame>
  );
}
