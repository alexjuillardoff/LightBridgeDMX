// Fader dessiné à la main (vertical par défaut, horizontal avec `orientation="horizontal"`).
// Pas d'<input type="range"> : le rendu natif diffère trop d'un navigateur à l'autre.
// Piloté au pointeur (capture dès l'appui) et au clavier (role="slider").
import { useCallback, useRef } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

type FaderProps = {
  /** Valeur courante entre `min` et `max` (par défaut 0..100). */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  orientation?: "vertical" | "horizontal";
  label: string;
  disabled?: boolean;
  className?: string;
  /** Texte lu par les lecteurs d'écran (ex. « 50 % »). */
  valueText?: string;
};

export function Fader({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  orientation = "vertical",
  label,
  disabled = false,
  className = "",
  valueText
}: FaderProps) {
  const track = useRef<HTMLDivElement>(null);
  const vertical = orientation === "vertical";
  const clamp = useCallback(
    (v: number) => {
      const snapped = Math.round(v / step) * step;
      return Math.max(min, Math.min(max, snapped));
    },
    [min, max, step]
  );
  const ratio = max > min ? (Math.max(min, Math.min(max, value)) - min) / (max - min) : 0;
  const pct = ratio * 100;

  // Convertit la position du pointeur en valeur (le haut d'un fader vertical = max).
  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const raw = vertical ? 1 - (clientY - r.top) / r.height : (clientX - r.left) / r.width;
      onChange(clamp(min + Math.max(0, Math.min(1, raw)) * (max - min)));
    },
    [clamp, max, min, onChange, vertical]
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPointer(e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyPointer(e.clientX, e.clientY);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = (max - min) / 10;
    const small = e.shiftKey ? step * 10 : step;
    const map: Record<string, number> = {
      ArrowUp: small,
      ArrowRight: small,
      ArrowDown: -small,
      ArrowLeft: -small,
      PageUp: big,
      PageDown: -big
    };
    if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      onChange(max);
      return;
    }
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    onChange(clamp(value + d));
  };

  const fillStyle: CSSProperties = vertical ? { height: `${pct}%` } : { width: `${pct}%` };
  const knobStyle: CSSProperties = vertical ? { bottom: `${pct}%` } : { left: `${pct}%` };

  return (
    <div
      ref={track}
      className={`ma-fader ${vertical ? "" : "ma-fader--h"} ${disabled ? "ma-fader--disabled" : ""} ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="ma-fader__fill" style={fillStyle} />
      <div className="ma-fader__knob" style={knobStyle} />
    </div>
  );
}
