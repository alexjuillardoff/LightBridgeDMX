// Cadre commun des overlays : fond assombri, dialogue avec barre de titre MA3,
// corps et pied optionnel. Un clic sur le fond ou Échap ferme (sauf `modal`).
import type { ReactNode } from "react";
import { IconClose } from "../icons";

type OverlayFrameProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Largeur du dialogue (rem). */
  width?: number;
  /** Plein écran (menu principal). */
  full?: boolean;
  /** Aligné en haut plutôt que centré (historique, calculator). */
  top?: boolean;
  /** Pas de fermeture par clic sur le fond. */
  modal?: boolean;
  className?: string;
};

export function OverlayFrame({ title, onClose, children, footer, width, full = false, top = false, modal = false, className = "" }: OverlayFrameProps) {
  return (
    <div className={`ma-overlay${top ? " ma-overlay--top" : ""}`} onClick={modal ? undefined : onClose} role="presentation">
      <div
        className={`ma-dialog${full ? " ma-dialog--full" : ""} ${className}`}
        style={width ? { width: `${width}rem` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ma-titlebar">
          <span className="ma-titlebar__ma" aria-hidden="true">
            MA
          </span>
          <span className="ma-titlebar__title">{title}</span>
          <button type="button" className="ma-titlebar__close" onClick={onClose} aria-label="Fermer">
            <IconClose />
          </button>
        </div>
        <div className="ma-dialog__body">{children}</div>
        {footer ? <div className="ma-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
