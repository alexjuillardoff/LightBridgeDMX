// Zone utilisateur : fond noir à grille de points, fenêtres de la vue courante placées
// sur une grille 24×16 proportionnelle. Clic sur le fond vide → dialogue Add Window à cet
// endroit. La fenêtre touchée passe au premier plan (z-order = ordre du tableau).
import { useCallback, useRef } from "react";
import type { MouseEvent } from "react";
import { GRID_COLS, GRID_ROWS, openOverlay, raiseWindow, useWorkspace } from "../state/workspace";
import { WindowFrame } from "./WindowFrame";

export function Screen() {
  const windows = useWorkspace((s) => s.views[s.current]?.windows ?? EMPTY);
  const ref = useRef<HTMLDivElement>(null);

  const onBackgroundClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((e.clientX - rect.left) / rect.width) * GRID_COLS)));
    const y = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((e.clientY - rect.top) / rect.height) * GRID_ROWS)));
    openOverlay("addWindow", { x, y });
  }, []);

  return (
    <div ref={ref} className="sh-screen" onClick={onBackgroundClick} role="main" aria-label="Écran">
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} screenRef={ref} onFocus={() => raiseWindow(w.id)} />
      ))}
    </div>
  );
}

const EMPTY: never[] = [];
