// Une fenêtre du plan de travail, à la manière d'un grandMA : barre de titre
// bleue, bille jaune, poignée de redimensionnement en bas à droite.
//
// Deux gestes seulement, ceux d'un pupitre :
//  - glisser la barre de titre déplace la fenêtre ;
//  - glisser le coin bas-droit la redimensionne.
// Les deux s'accrochent à la grille (colonnes / rangées) : impossible de poser
// une fenêtre de travers, et deux fenêtres voisines s'alignent toutes seules.
//
// Le déplacement est piloté aux Pointer Events (souris ET tactile ET stylet avec
// le même code) et la position en cours de glissement vit dans un état local :
// le parent n'est prévenu qu'au relâchement, ce qui évite de re-rendre tout le
// plan de travail à chaque pixel.
import { PointerEvent, ReactNode, useCallback, useRef, useState } from "react";
import { GripHorizontal, X } from "lucide-react";
import { ConsoleWindow as WindowModel, GRID_COLS, ROW_PX, clampWindow } from "../../lib/console/layout";

type ConsoleWindowProps = {
  win: WindowModel;
  title: string;
  // Badge optionnel affiché à droite du titre (compteur, état…).
  badge?: ReactNode;
  children: ReactNode;
  // Appelé au relâchement, avec la géométrie finale.
  onChange: (next: WindowModel) => void;
  onClose: () => void;
  // Passe la fenêtre au premier plan quand on la touche.
  onFocus: () => void;
  z: number;
};

// Geste en cours. `mode` distingue déplacement et redimensionnement ; les
// origines servent à travailler en delta plutôt qu'en position absolue.
type Drag = {
  mode: "move" | "resize";
  originX: number;
  originY: number;
  startWin: WindowModel;
  colPx: number;
};

export const ConsoleWindow = ({
  win,
  title,
  badge,
  children,
  onChange,
  onClose,
  onFocus,
  z
}: ConsoleWindowProps) => {
  const rootRef = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  // Géométrie affichée pendant un glissement ; null le reste du temps (on rend
  // alors la géométrie du modèle).
  const [draft, setDraft] = useState<WindowModel | null>(null);
  const shown = draft ?? win;

  // Largeur d'une colonne en pixels, mesurée sur le plan de travail parent :
  // c'est ce qui traduit un déplacement en pixels vers un déplacement en grille.
  const columnPx = useCallback(() => {
    const workspace = rootRef.current?.parentElement;
    const width = workspace?.clientWidth ?? window.innerWidth;
    return width / GRID_COLS;
  }, []);

  const startDrag = (mode: Drag["mode"]) => (evt: PointerEvent<HTMLElement>) => {
    // Bouton droit / molette : on laisse le navigateur faire.
    if (evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    onFocus();
    (evt.target as HTMLElement).setPointerCapture(evt.pointerId);
    drag.current = {
      mode,
      originX: evt.clientX,
      originY: evt.clientY,
      startWin: win,
      colPx: columnPx()
    };
    setDraft(win);
  };

  const onPointerMove = (evt: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    // Delta converti en unités de grille, arrondi : c'est l'accrochage.
    const dCol = Math.round((evt.clientX - current.originX) / current.colPx);
    const dRow = Math.round((evt.clientY - current.originY) / ROW_PX);
    const start = current.startWin;

    if (current.mode === "move") {
      setDraft(clampWindow({ ...start, x: start.x + dCol, y: start.y + dRow }));
      return;
    }

    // Redimensionnement : on borne la largeur à ce qui reste À DROITE du coin
    // haut-gauche. Sans ça, `clampWindow` corrigerait en reculant `x`, et la
    // fenêtre glisserait vers la gauche alors qu'on tire son coin droit.
    const maxW = GRID_COLS - start.x;
    setDraft(
      clampWindow({
        ...start,
        w: Math.min(maxW, start.w + dCol),
        h: start.h + dRow
      })
    );
  };

  const endDrag = (evt: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    (evt.target as HTMLElement).releasePointerCapture?.(evt.pointerId);
    drag.current = null;
    // On ne remonte au parent qu'ici : un seul rendu du plan de travail par geste.
    if (draft) onChange(draft);
    setDraft(null);
  };

  return (
    <section
      ref={rootRef}
      className={`ma-win ${draft ? "ma-win-dragging" : ""}`}
      style={{
        left: `${(shown.x / GRID_COLS) * 100}%`,
        width: `${(shown.w / GRID_COLS) * 100}%`,
        top: shown.y * ROW_PX,
        height: shown.h * ROW_PX,
        zIndex: z
      }}
      onPointerDown={onFocus}
    >
      <header
        className="ma-win-title"
        onPointerDown={startDrag("move")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripHorizontal size={12} strokeWidth={2.4} aria-hidden="true" className="ma-win-grip" />
        <span className="ma-win-name">{title}</span>
        {badge ? <span className="ma-win-badge">{badge}</span> : null}
        <button
          type="button"
          className="ma-win-close"
          aria-label={`Fermer la fenêtre ${title}`}
          // Le pointerdown est stoppé pour que le clic de fermeture ne démarre
          // pas un déplacement de la fenêtre.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <X size={12} strokeWidth={3} aria-hidden="true" />
        </button>
      </header>

      <div className="ma-win-body">{children}</div>

      <span
        className="ma-win-resize"
        role="separator"
        aria-label={`Redimensionner la fenêtre ${title}`}
        onPointerDown={startDrag("resize")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </section>
  );
};
