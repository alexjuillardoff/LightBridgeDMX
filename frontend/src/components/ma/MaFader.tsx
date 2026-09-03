// Fader facon pupitre : piste encastree, remplissage lumineux et poignee claire.
//
// On n'utilise pas <input type="range"> : le rendu natif d'un slider vertical
// differe fortement d'un navigateur a l'autre (et Chrome deprecie l'ancienne
// syntaxe). Ici tout est dessine par nos soins et pilote au pointeur, donc le
// resultat est identique partout, souris comme tactile.
//
// L'accessibilite est assuree a la main : role="slider", valeurs ARIA et
// raccourcis clavier (fleches, PageUp/Down, Home/End).
import { CSSProperties, KeyboardEvent, PointerEvent, useCallback, useRef } from "react";

type MaFaderProps = {
  // Valeur DMX brute, 0-255.
  value: number;
  onChange: (value: number) => void;
  // Sens du fader : vertical (console) ou horizontal (barre d'encodeurs).
  orientation?: "vertical" | "horizontal";
  // Libelle lu par les lecteurs d'ecran.
  label: string;
  // Couleur du remplissage (par defaut le bleu du pupitre).
  fill?: string;
  // Hauteur en pixels d'un fader vertical.
  height?: number;
};

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const MaFader = ({
  value,
  onChange,
  orientation = "vertical",
  label,
  fill,
  height
}: MaFaderProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const vertical = orientation === "vertical";
  // Position du remplissage et de la poignee, en pourcentage de la piste.
  const ratio = clamp255(value) / 255;
  const percent = ratio * 100;

  // Convertit la position du pointeur en valeur DMX.
  // En vertical, le haut de la piste vaut 255 (d'ou l'inversion).
  const applyFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const raw = vertical
        ? 1 - (clientY - rect.top) / rect.height
        : (clientX - rect.left) / rect.width;
      onChange(clamp255(raw * 255));
    },
    [onChange, vertical]
  );

  // Le pointeur est capture des l'appui : on continue a suivre le geste meme
  // si le doigt/la souris sort du fader, comme sur un vrai pupitre.
  const handlePointerDown = (evt: PointerEvent<HTMLDivElement>) => {
    evt.currentTarget.setPointerCapture(evt.pointerId);
    applyFromPointer(evt.clientX, evt.clientY);
  };

  const handlePointerMove = (evt: PointerEvent<HTMLDivElement>) => {
    if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
    applyFromPointer(evt.clientX, evt.clientY);
  };

  const handleKeyDown = (evt: KeyboardEvent<HTMLDivElement>) => {
    // Pas de modificateur : 1 point DMX. Avec Maj : 10. PageUp/Down : ~10 %.
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

  // Style du remplissage : hauteur en vertical, largeur en horizontal.
  const fillStyle: CSSProperties = vertical ? { height: `${percent}%` } : { width: `${percent}%` };
  if (fill) fillStyle.background = fill;

  return (
    <div
      ref={trackRef}
      className={vertical ? "ma-fader" : "ma-fader-h"}
      style={vertical && height ? { height } : undefined}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={255}
      aria-valuenow={clamp255(value)}
      aria-valuetext={`${Math.round(ratio * 100)} %`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      <div className="ma-fader-fill" style={fillStyle} />
      {/* La poignee n'existe qu'en vertical : en horizontal, le bord du
          remplissage suffit a lire la valeur (comme les encodeurs MA). */}
      {vertical ? <div className="ma-fader-knob" style={{ bottom: `${percent}%` }} /> : null}
    </div>
  );
};
