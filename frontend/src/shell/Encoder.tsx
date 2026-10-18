// Encodeur MA3 : boîte d'attribut (étiquette en haut, valeur dessous, bande sombre en bas)
// avec la molette ronde claire à gauche. La molette se tourne en glissant verticalement
// (1 px = 1 DMX, Maj = ×0,2 fin), à la molette de souris et au clavier (flèches, Page,
// Home/End) ; un clic sur la boîte ouvre le Calculator.
import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, WheelEvent } from "react";

export type EncoderProps = {
  /** Étiquette MA3 de l'attribut (Dim, Pan…) ; null = boîte vide. */
  label: string | null;
  /** Valeur formatée selon le readout (vide si inconnue). */
  display: string;
  /** Valeur courante en DMX 0-255 (ARIA et Home/End), null si inconnue. */
  value: number | null;
  /** Valeur active dans le programmer → fond rouge. */
  active?: boolean;
  /** Attribut absent de la sélection : boîte grisée, molette inerte. */
  disabled?: boolean;
  /** Variation demandée, en points DMX (entier). */
  onDelta?: (delta: number) => void;
  /** Valeur absolue demandée (Home/End). */
  onSet?: (value: number) => void;
  /** Clic sur la boîte (ouvre le Calculator). */
  onOpen?: () => void;
  /** Variante réduite (command wing bar). */
  compact?: boolean;
  /** Bornes ARIA (par défaut 0..255). */
  min?: number;
  max?: number;
};

export function Encoder({
  label,
  display,
  value,
  active = false,
  disabled = false,
  onDelta,
  onSet,
  onOpen,
  compact = false,
  min = 0,
  max = 255
}: EncoderProps) {
  const [dragging, setDragging] = useState(false);
  const last = useRef<number | null>(null);
  // Reste fractionnaire du mode fin (Maj) : on n'émet que des entiers.
  const acc = useRef(0);
  const inert = disabled || label === null;

  const emit = useCallback(
    (raw: number) => {
      if (!onDelta) return;
      acc.current += raw;
      const whole = acc.current > 0 ? Math.floor(acc.current) : Math.ceil(acc.current);
      if (whole !== 0) {
        acc.current -= whole;
        onDelta(whole);
      }
    },
    [onDelta]
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (inert || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = e.clientY;
    acc.current = 0;
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dy = last.current - e.clientY;
    last.current = e.clientY;
    emit(dy * (e.shiftKey ? 0.2 : 1));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current === null) return;
    last.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (inert) return;
    const notch = Math.sign(-e.deltaY);
    if (notch === 0) return;
    emit(notch * (e.altKey ? 10 : 1));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inert) return;
    const small = e.shiftKey ? 10 : 1;
    const map: Record<string, number> = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: 26, PageDown: -26 };
    if (e.key === "Home" && onSet) {
      e.preventDefault();
      onSet(min);
      return;
    }
    if (e.key === "End" && onSet) {
      e.preventDefault();
      onSet(max);
      return;
    }
    if (e.key === "Enter" && onOpen) {
      e.preventDefault();
      onOpen();
      return;
    }
    const d = map[e.key];
    if (d === undefined) return;
    e.preventDefault();
    emit(d);
  };

  const cls = [
    "sh-enc",
    compact ? "sh-enc--compact" : "",
    label === null ? "is-empty" : "",
    disabled ? "is-disabled" : "",
    active ? "is-active" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className="sh-enc__strip" aria-hidden="true">
        <span className="ma-btn__caret" />
      </div>
      <div
        className="sh-enc__main"
        onClick={inert || !onOpen ? undefined : onOpen}
        role={inert || !onOpen ? undefined : "button"}
        tabIndex={inert || !onOpen ? undefined : -1}
        title={label && !inert ? `${label} : cliquer pour saisir une valeur` : undefined}
      >
        <div className="sh-enc__top">
          <span className="sh-enc__label">{label ?? ""}</span>
          <span className="sh-enc__value">{display}</span>
        </div>
        <div className="sh-enc__bottom" />
        <div
          className={`ma-knob${compact ? " ma-knob--small" : ""}${inert ? " ma-knob--disabled" : ""}${dragging ? " ma-knob--dragging" : ""}`}
          role="slider"
          tabIndex={inert ? -1 : 0}
          aria-label={label ?? "Encodeur vide"}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value ?? undefined}
          aria-valuetext={display || undefined}
          aria-disabled={inert || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ma-knob__center">
            <i className="ma-knob__dot" />
            <i className="ma-knob__dot" />
            <i className="ma-knob__dot" />
            <i className="ma-knob__dot" />
          </div>
        </div>
      </div>
    </div>
  );
}
