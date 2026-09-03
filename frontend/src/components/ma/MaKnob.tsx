// Molette d'encodeur, dessinée comme celles de la surface d'un grandMA2 :
// anneau métallique sombre, repère coloré qui tourne avec la valeur, et un arc
// de niveau autour. On la tourne en glissant verticalement (ou horizontalement),
// comme on tournerait la molette physique.
import { KeyboardEvent, PointerEvent, useRef } from "react";

type MaKnobProps = {
  // Valeur DMX brute, 0-255.
  value: number;
  onChange: (value: number) => void;
  // Libellé lu par les lecteurs d'écran.
  label: string;
  // Couleur du repère et de l'arc (code couleur du groupe d'attributs).
  color?: string;
};

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

// Amplitude de rotation du repère : ±135° autour du haut, comme un potentiomètre.
const ANGLE_RANGE = 270;

export const MaKnob = ({ value, onChange, label, color = "var(--yellow)" }: MaKnobProps) => {
  // Position du pointeur au dernier événement, pour travailler en relatif :
  // une molette n'a pas de "position absolue" comme un fader.
  const last = useRef<{ x: number; y: number } | null>(null);
  const ratio = clamp255(value) / 255;
  const angle = -ANGLE_RANGE / 2 + ratio * ANGLE_RANGE;

  const handlePointerDown = (evt: PointerEvent<HTMLDivElement>) => {
    evt.currentTarget.setPointerCapture(evt.pointerId);
    last.current = { x: evt.clientX, y: evt.clientY };
  };

  const handlePointerMove = (evt: PointerEvent<HTMLDivElement>) => {
    if (!last.current || !evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
    // Vers le haut ou vers la droite = on monte. 1 pixel ≈ 1,5 point DMX,
    // ce qui donne une course complète en ~170 px de glissement.
    const delta = last.current.y - evt.clientY + (evt.clientX - last.current.x);
    last.current = { x: evt.clientX, y: evt.clientY };
    onChange(clamp255(value + delta * 1.5));
  };

  const handlePointerUp = () => {
    last.current = null;
  };

  const handleKeyDown = (evt: KeyboardEvent<HTMLDivElement>) => {
    const step = evt.shiftKey ? 10 : 1;
    const map: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: 26,
      PageDown: -26
    };
    if (evt.key === "Home") {
      evt.preventDefault();
      onChange(0);
      return;
    }
    if (evt.key === "End") {
      evt.preventDefault();
      onChange(255);
      return;
    }
    const delta = map[evt.key];
    if (delta === undefined) return;
    evt.preventDefault();
    onChange(clamp255(value + delta));
  };

  return (
    <div className="ma-knob-wrap">
      <span className="ma-knob-arrow" aria-hidden="true">
        ▲
      </span>
      <div
        className="ma-knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={clamp255(value)}
        aria-valuetext={`${Math.round(ratio * 100)} %`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {/* Arc de niveau : un dégradé conique tronqué au ratio courant. */}
        <div
          className="ma-knob-ring"
          style={{
            background: `conic-gradient(from 225deg, ${color} 0deg ${ratio * ANGLE_RANGE}deg, #1a1a1a ${
              ratio * ANGLE_RANGE
            }deg 270deg, transparent 270deg 360deg)`,
            // On évide le centre pour ne garder qu'un anneau fin.
            mask: "radial-gradient(circle, transparent 0 62%, #000 63%)",
            WebkitMask: "radial-gradient(circle, transparent 0 62%, #000 63%)"
          }}
        />
        <div className="ma-knob-mark" style={{ transform: `rotate(${angle}deg)`, background: color }} />
      </div>
      <span className="ma-knob-arrow" aria-hidden="true">
        ▼
      </span>
    </div>
  );
};
