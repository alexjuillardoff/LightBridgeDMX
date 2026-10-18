// Menu contextuel MA3 (appui long / clic droit / carré « MA » d'une fenêtre).
// Positionné en fixed à l'endroit demandé, rabattu dans la fenêtre si besoin,
// fermé par un clic à l'extérieur ou Échap.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Séparateur avant cet élément. */
  sep?: boolean;
};

type ContextMenuProps = { x: number; y: number; items: MenuItem[]; title?: string; onClose: () => void };

export function ContextMenu({ x, y, items, title, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Rabat le menu dans la fenêtre s'il déborde.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(0, Math.min(x, window.innerWidth - r.width - 4));
    const top = Math.max(0, Math.min(y, window.innerHeight - r.height - 4));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ma-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {title ? <div className="ma-menu__title">{title}</div> : null}
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} style={{ display: "contents" }}>
          {it.sep ? <div className="ma-menu__sep" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`ma-menu__item${it.danger ? " ma-menu__item--danger" : ""}${it.disabled ? " ma-menu__item--disabled" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onSelect?.();
            }}
          >
            {it.label}
          </button>
        </span>
      ))}
    </div>
  );
}
