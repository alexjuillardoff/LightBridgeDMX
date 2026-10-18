// Appui long (500 ms par défaut) à la façon MA3 : souris comme tactile, via les
// Pointer Events. Un clic bref déclenche `onClick`, un appui maintenu `onLongPress`
// (une seule fois), et le clic droit est traité comme un appui long.
import { useCallback, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

type Options = {
  ms?: number;
  onClick?: (e: PointerEvent<HTMLElement>) => void;
  onLongPress: (e: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>) => void;
  /** Tolérance de déplacement (px) avant d'annuler l'appui long. */
  slop?: number;
};

export function useLongPress({ ms = 500, onClick, onLongPress, slop = 8 }: Options) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // Le clic droit passe par onContextMenu.
      if (e.button !== 0) return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(e);
      }, ms);
    },
    [cancel, ms, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!origin.current || timer.current === null) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      if (Math.abs(dx) > slop || Math.abs(dy) > slop) cancel();
    },
    [cancel, slop]
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const wasPending = timer.current !== null;
      cancel();
      if (!fired.current && wasPending && onClick) onClick(e);
      origin.current = null;
    },
    [cancel, onClick]
  );

  const onPointerLeave = useCallback(() => {
    cancel();
    origin.current = null;
  }, [cancel]);

  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      cancel();
      fired.current = true;
      onLongPress(e);
    },
    [cancel, onLongPress]
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerLeave, onPointerLeave, onContextMenu };
}
