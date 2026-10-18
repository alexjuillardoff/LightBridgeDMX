// View bar droite : 7 boutons de vue. Clic = afficher la vue ; appui long (500 ms)
// ou clic droit = overlay Store View / Delete View. Bouton affecté : face grise, nom,
// œil ; vide : fond sombre et numéro seul. Vue courante : liseré jaune à gauche.
import type { KeyboardEvent } from "react";
import type { View } from "../state/workspace";
import { openOverlay, showView, useWorkspace } from "../state/workspace";
import { IconEye } from "./icons";
import { useLongPress } from "./useLongPress";

type ViewButtonProps = { index: number; view: View | null; current: boolean };

function ViewButton({ index, view, current }: ViewButtonProps) {
  const press = useLongPress({
    onClick: () => showView(index),
    onLongPress: () => openOverlay("storeView", { index })
  });
  const assigned = view !== null;
  // Clavier : Entrée / Espace affichent la vue, Maj+F10 ou la touche Menu ouvrent Store View.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showView(index);
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openOverlay("storeView", { index });
    }
  };
  return (
    <button
      type="button"
      className={`sh-vb__btn${assigned ? " is-assigned" : ""}${current ? " is-current" : ""}`}
      title={assigned ? `${view.name} — appui long : Store / Delete View` : "Vue vide — appui long : Store View"}
      aria-label={assigned ? `Vue ${index + 1} : ${view.name}` : `Vue ${index + 1} vide`}
      aria-current={current ? "true" : undefined}
      onKeyDown={onKeyDown}
      {...press}
    >
      <span className="sh-vb__num">{index + 1}</span>
      {assigned ? (
        <span className="sh-vb__eye" aria-hidden="true">
          <IconEye />
        </span>
      ) : null}
      {assigned ? <span className="sh-vb__name">{view.name}</span> : null}
    </button>
  );
}

export function ViewBar() {
  const views = useWorkspace((s) => s.views);
  const current = useWorkspace((s) => s.current);
  return (
    <nav className="sh-vb" aria-label="View bar" data-neutral="">
      {views.map((v, i) => (
        <ViewButton key={i} index={i} view={v} current={i === current} />
      ))}
    </nav>
  );
}
