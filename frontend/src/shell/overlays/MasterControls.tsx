// Overlay « Master Controls » : Grand Master (fader vertical), Blackout (bascule rouge),
// Highlight, Off All Phasers.
import { useStore } from "../../lib/store";
import { useRunningEffects } from "../../state/app";
import { programmerStore, setBlackout, setGrandMaster, toggleHighlight } from "../../state/programmer";
import { closeOverlay } from "../../state/workspace";
import { stopAllEffects } from "../actions";
import { Fader } from "../Fader";
import { OverlayFrame } from "./OverlayFrame";

export function MasterControls() {
  const gm = useStore(programmerStore, (s) => s.grandMaster);
  const blackout = useStore(programmerStore, (s) => s.blackout);
  const highlight = useStore(programmerStore, (s) => s.highlight);
  const running = useRunningEffects();

  return (
    <OverlayFrame title="Master Controls" onClose={closeOverlay} width={30}>
      <div className="sh-mc">
        <div className="sh-mc__gm">
          <div className="sh-mc__gmhead">Grand Master</div>
          <div className={`sh-mc__gmvalue${blackout ? " is-blackout" : ""}`}>{blackout ? "B.O." : `${gm}%`}</div>
          <Fader className="ma-fader--gm sh-mc__fader" value={gm} onChange={setGrandMaster} label="Grand Master" valueText={`${gm} %`} />
          <div className="ma-row">
            <button type="button" className="ma-btn ma-btn--small" onClick={() => setGrandMaster(0)}>
              0
            </button>
            <button type="button" className="ma-btn ma-btn--small" onClick={() => setGrandMaster(50)}>
              50
            </button>
            <button type="button" className="ma-btn ma-btn--small" onClick={() => setGrandMaster(100)}>
              100
            </button>
          </div>
        </div>
        <div className="sh-mc__btns">
          <button
            type="button"
            className={`ma-btn ma-btn--danger sh-mc__btn${blackout ? " ma-btn--active" : ""}`}
            aria-pressed={blackout}
            onClick={() => setBlackout(!blackout)}
          >
            Blackout
          </button>
          <button
            type="button"
            className={`ma-btn sh-mc__btn${highlight ? " ma-btn--active" : ""}`}
            aria-pressed={highlight}
            onClick={() => toggleHighlight()}
          >
            Highlight
          </button>
          <button type="button" className="ma-btn sh-mc__btn" disabled={running.length === 0} onClick={() => void stopAllEffects()}>
            {`Off All Phasers${running.length > 0 ? ` (${running.length})` : ""}`}
          </button>
          <p className="ma-dialog__text">
            Le Grand Master n'atténue que l'intensité et les couleurs (r/g/b/w/uv) : pan, tilt, gobos et roues restent en place.
          </p>
        </div>
      </div>
    </OverlayFrame>
  );
}
