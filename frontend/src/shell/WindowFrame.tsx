// Cadre MA3 d'une fenêtre : barre de titre (carré « MA » → menu Settings / Delete Window,
// titre, boutons propres à la fenêtre, ✕), corps, poignée de redimensionnement en bas à
// droite. Déplacement par la barre de titre et redimensionnement accrochés à la grille 24×16.
import { useCallback, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { WindowInstance } from "../state/workspace";
import { GRID_COLS, GRID_ROWS, removeWindow, setWindowSettings, updateWindow } from "../state/workspace";
import { WINDOWS } from "../windows/registry";
import { IconClose } from "./icons";
import { ContextMenu } from "./overlays/ContextMenu";
import { toast } from "./Toasts";

type WindowFrameProps = {
  win: WindowInstance;
  /** Zone utilisateur, pour convertir les pixels en cellules de grille. */
  screenRef: RefObject<HTMLDivElement>;
  /** Appelé à l'appui : passe la fenêtre au premier plan. */
  onFocus: () => void;
};

type Gesture = { pointerId: number; startX: number; startY: number; orig: WindowInstance; cellW: number; cellH: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function WindowFrame({ win, screenRef, onFocus }: WindowFrameProps) {
  const mod = WINDOWS[win.kind];
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<Gesture | null>(null);
  const resize = useRef<Gesture | null>(null);

  const setSettings = useCallback((patch: Record<string, unknown>) => setWindowSettings(win.id, patch), [win.id]);

  const beginGesture = (e: PointerEvent<HTMLElement>): Gesture | null => {
    const rect = screenRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    e.currentTarget.setPointerCapture(e.pointerId);
    return {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      orig: win,
      cellW: rect.width / GRID_COLS,
      cellH: rect.height / GRID_ROWS
    };
  };

  // --- Déplacement par la barre de titre ---
  const onTitlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof HTMLElement && e.target.closest("button, input, select, [role=slider]")) return;
    drag.current = beginGesture(e);
  };
  const onTitlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const x = clamp(g.orig.x + Math.round((e.clientX - g.startX) / g.cellW), 0, GRID_COLS - g.orig.w);
    const y = clamp(g.orig.y + Math.round((e.clientY - g.startY) / g.cellH), 0, GRID_ROWS - g.orig.h);
    if (x !== win.x || y !== win.y) updateWindow(win.id, { x, y });
  };
  const onTitlePointerUp = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  // --- Redimensionnement par le coin bas-droit ---
  const minW = mod.minSize?.w ?? 3;
  const minH = mod.minSize?.h ?? 2;
  const onResizePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resize.current = beginGesture(e);
  };
  const onResizePointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = resize.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const w = clamp(g.orig.w + Math.round((e.clientX - g.startX) / g.cellW), minW, GRID_COLS - g.orig.x);
    const h = clamp(g.orig.h + Math.round((e.clientY - g.startY) / g.cellH), minH, GRID_ROWS - g.orig.y);
    if (w !== win.w || h !== win.h) updateWindow(win.id, { w, h });
  };
  const onResizePointerUp = (e: PointerEvent<HTMLElement>) => {
    if (resize.current?.pointerId === e.pointerId) resize.current = null;
  };

  const style: CSSProperties = {
    left: `${(win.x / GRID_COLS) * 100}%`,
    top: `${(win.y / GRID_ROWS) * 100}%`,
    width: `${(win.w / GRID_COLS) * 100}%`,
    height: `${(win.h / GRID_ROWS) * 100}%`
  };

  const Component = mod.Component;
  const TitleExtras = mod.TitleExtras;

  return (
    <section className="sh-win" style={style} aria-label={mod.title} onPointerDownCapture={onFocus}>
      <header
        className="ma-titlebar sh-win__title"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
        onDoubleClick={(e) => {
          // Double-clic sur le titre : agrandit la fenêtre à tout l'écran (ou la rétablit).
          if (e.target instanceof HTMLElement && e.target.closest("button")) return;
          const full = win.x === 0 && win.y === 0 && win.w === GRID_COLS && win.h === GRID_ROWS;
          updateWindow(win.id, full ? { w: mod.defaultSize.w, h: mod.defaultSize.h } : { x: 0, y: 0, w: GRID_COLS, h: GRID_ROWS });
        }}
      >
        <button
          type="button"
          className="ma-titlebar__ma"
          onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
          title="Réglages de la fenêtre"
          aria-label="Réglages de la fenêtre"
          aria-haspopup="menu"
        >
          MA
        </button>
        <span className="ma-titlebar__title">{mod.title}</span>
        <div className="ma-titlebar__extras">{TitleExtras ? <TitleExtras win={win} setSettings={setSettings} /> : null}</div>
        <button type="button" className="ma-titlebar__close" onClick={() => removeWindow(win.id)} aria-label="Fermer la fenêtre">
          <IconClose />
        </button>
      </header>
      <div className="sh-win__body">
        <Component win={win} setSettings={setSettings} />
      </div>
      <div
        className="sh-win__resize"
        role="presentation"
        title="Redimensionner"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={mod.title}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Settings",
              onSelect: () =>
                toast(TitleExtras ? "Les réglages de cette fenêtre sont dans sa barre de titre." : "Cette fenêtre n'a pas de réglages.", "info")
            },
            { label: "Delete Window", danger: true, sep: true, onSelect: () => removeWindow(win.id) }
          ]}
        />
      ) : null}
    </section>
  );
}
