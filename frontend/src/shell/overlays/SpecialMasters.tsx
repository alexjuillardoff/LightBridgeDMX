// Overlay « Special Masters » : Speed Master (multiplicateur Rate des phasers en cours,
// PUT /api/effects/:id avec debounce 150 ms) et Program Time (décoratif).
import { useEffect, useRef, useState } from "react";
import { useRunningEffects } from "../../state/app";
import { closeOverlay } from "../../state/workspace";
import { setEffectRate } from "../actions";
import { Fader } from "../Fader";
import { OverlayFrame } from "./OverlayFrame";

const DEBOUNCE_MS = 150;
// Course du fader : 0..100 ↔ rate 0,25× .. 4× (échelle log, 50 = 1×).
const faderToRate = (v: number) => Math.round(Math.pow(2, (v - 50) / 25) * 100) / 100;
const rateToFader = (r: number) => Math.round(50 + 25 * Math.log2(Math.max(0.25, Math.min(4, r))));

export function SpecialMasters() {
  const running = useRunningEffects();
  const [fader, setFader] = useState(() => rateToFader(running[0]?.effect.rate ?? 1));
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const onChange = (v: number) => {
    setFader(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const rate = faderToRate(v);
      for (const r of running) void setEffectRate(r, rate);
    }, DEBOUNCE_MS);
  };

  const rate = faderToRate(fader);

  return (
    <OverlayFrame title="Special Masters" onClose={closeOverlay} width={34}>
      <div className="sh-masters">
        <div className="sh-masters__item">
          <div className="sh-masters__head">
            <span>Speed Master</span>
            <span className="ma-yellow">{rate.toFixed(2)} ×</span>
          </div>
          <Fader orientation="horizontal" value={fader} onChange={onChange} label="Speed Master" disabled={running.length === 0} valueText={`${rate} fois`} />
          <div className="ma-muted sh-masters__note">
            {running.length === 0 ? "Aucun phaser en cours." : `${running.length} phaser(s) en cours — Rate appliqué à tous.`}
          </div>
          <div className="ma-row">
            {[0.5, 1, 2].map((r) => (
              <button key={r} type="button" className="ma-btn ma-btn--small" disabled={running.length === 0} onClick={() => onChange(rateToFader(r))}>
                {r} ×
              </button>
            ))}
          </div>
        </div>
        <div className="sh-masters__item is-disabled">
          <div className="sh-masters__head">
            <span>Program Time</span>
            <span className="ma-dim">0.0 s</span>
          </div>
          <Fader orientation="horizontal" value={0} onChange={() => undefined} label="Program Time" disabled />
          <div className="ma-dim sh-masters__note">Non disponible : les valeurs du programmer sont posées instantanément.</div>
        </div>
      </div>
    </OverlayFrame>
  );
}
