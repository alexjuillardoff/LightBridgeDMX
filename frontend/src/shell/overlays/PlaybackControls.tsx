// Overlay « Playback Controls » : les 20 executors (scènes) avec niveau, Go+ et Off.
import { goExecutor, offExecutor, setExecutorLevel, useExecutors } from "../../state/playback";
import { closeOverlay } from "../../state/workspace";
import { Fader } from "../Fader";
import { toast } from "../Toasts";
import { OverlayFrame } from "./OverlayFrame";

export function PlaybackControls() {
  const executors = useExecutors();
  const go = async (slot: number) => {
    const r = await goExecutor(slot);
    if (!r.ok) toast(r.message, "error");
  };
  const off = (slot: number) => {
    const r = offExecutor(slot);
    if (!r.ok) toast(r.message, "error");
  };
  return (
    <OverlayFrame title="Playback Controls" onClose={closeOverlay} width={40}>
      <div className="sh-pc">
        {executors.map((ex) => (
          <div key={ex.slot} className={`sh-pc__row${ex.scene ? "" : " is-empty"}${ex.active ? " is-active" : ""}`}>
            <span className="sh-pc__num">{ex.slot}</span>
            <span className="sh-pc__name ma-ellipsis">{ex.scene?.name ?? "—"}</span>
            <Fader
              className="ma-fader--exec"
              orientation="horizontal"
              value={Math.round(ex.level * 100)}
              onChange={(v) => setExecutorLevel(ex.slot, v / 100)}
              label={`Executor ${ex.slot}`}
              disabled={!ex.scene}
              valueText={`${Math.round(ex.level * 100)} %`}
            />
            <span className="sh-pc__level">{Math.round(ex.level * 100)}%</span>
            <button type="button" className="ma-btn ma-btn--small ma-btn--ok ma-btn--active" disabled={!ex.scene} onClick={() => void go(ex.slot)}>
              Go+
            </button>
            <button type="button" className="ma-btn ma-btn--small" disabled={!ex.scene} onClick={() => off(ex.slot)}>
              Off
            </button>
          </div>
        ))}
      </div>
    </OverlayFrame>
  );
}
