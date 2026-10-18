// Overlay « Calculator » (clic sur la boîte d'un encodeur) : pavé 0-9, « . », Thru (fan
// sur la sélection), raccourcis 0 / 25 / 50 / 75 / 100 %, Full, Out, Please. Travaille en
// pour cent ; le clavier physique est accepté (chiffres, Entrée, Retour).
import { useEffect, useState } from "react";
import { closeOverlay } from "../../state/workspace";
import { OverlayFrame } from "./OverlayFrame";

export type CalculatorPayload = {
  /** Étiquette de l'attribut (Dim, Pan…). */
  label: string;
  /** Valeur courante en pour cent, null si inconnue. */
  value: number | null;
  /** Valeur saisie (pour cent, 0..100). */
  onSubmit: (percent: number) => void;
  /** « a Thru b » : fan de `from` à `to` sur la sélection (optionnel). */
  onSubmitRange?: (from: number, to: number) => void;
};

export function isCalculatorPayload(p: unknown): p is CalculatorPayload {
  return typeof p === "object" && p !== null && "label" in p && "onSubmit" in p && typeof (p as CalculatorPayload).onSubmit === "function";
}

const QUICK = [0, 25, 50, 75, 100];

export function Calculator({ payload }: { payload: CalculatorPayload }) {
  const [text, setText] = useState("");

  const submit = () => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:thru\s*(-?\d+(?:\.\d+)?))?\s*$/i.exec(text);
    if (!m) {
      if (text.trim().length === 0) closeOverlay();
      return;
    }
    const a = Math.max(0, Math.min(100, Number(m[1])));
    if (m[2] !== undefined && payload.onSubmitRange) {
      payload.onSubmitRange(a, Math.max(0, Math.min(100, Number(m[2]))));
    } else {
      payload.onSubmit(a);
    }
    closeOverlay();
  };
  const quick = (pct: number) => {
    payload.onSubmit(pct);
    closeOverlay();
  };
  const append = (s: string) => setText((t) => t + s);
  const thru = () => setText((t) => (t.trim().length === 0 ? `${payload.value ?? 0} Thru ` : t.endsWith("Thru ") ? t : `${t.trim()} Thru `));

  // Clavier physique.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setText((t) => t.slice(0, -1));
      } else if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        append(e.key);
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        e.stopPropagation();
        thru();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, payload]);

  return (
    <OverlayFrame title={`${payload.label} — Calculator`} onClose={closeOverlay} width={24} top>
      <div className="sh-calc__display" aria-live="polite">
        <span className="sh-calc__current ma-muted">{payload.value === null ? "—" : `${payload.value} %`}</span>
        <span className="sh-calc__text">{text.length > 0 ? text : " "}</span>
      </div>
      <div className="sh-calc__quick">
        {QUICK.map((q) => (
          <button key={q} type="button" className="ma-btn ma-btn--small" onClick={() => quick(q)}>
            {`${q} %`}
          </button>
        ))}
      </div>
      <div className="sh-calc__pad">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "."].map((k) => (
          <button key={k} type="button" className="ma-btn sh-calc__key" onClick={() => append(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="ma-btn sh-calc__key" onClick={() => setText((t) => t.slice(0, -1))} aria-label="Effacer">
          ⌫
        </button>
        <button type="button" className="ma-btn sh-calc__key" onClick={thru} disabled={!payload.onSubmitRange}>
          Thru
        </button>
        <button type="button" className="ma-btn sh-calc__key" onClick={() => quick(100)}>
          Full
        </button>
        <button type="button" className="ma-btn sh-calc__key" onClick={() => quick(0)}>
          Out
        </button>
        <button type="button" className="ma-btn sh-calc__key sh-calc__please ma-btn--active" onClick={submit}>
          Please
        </button>
      </div>
    </OverlayFrame>
  );
}
