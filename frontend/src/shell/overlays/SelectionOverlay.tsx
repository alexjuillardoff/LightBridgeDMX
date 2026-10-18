// Overlay « Selection » (bouton ⋯ de l'encoder bar) : liste ordonnée de la sélection,
// Invert, Next / Prev (un seul projecteur), Select All, Clear.
import { useMemo } from "react";
import { usePatch } from "../../lib/patch";
import { clearSelection, invertSelection, select, selectAll, selectNext, selectPrev, useSelectedFixtures } from "../../state/programmer";
import { IconLock } from "../icons";
import { OverlayFrame } from "./OverlayFrame";

export function SelectionOverlay({ onClose }: { onClose: () => void }) {
  const patch = usePatch();
  const selected = useSelectedFixtures();
  const selectable = useMemo(() => patch.filter((f) => f.locked === null), [patch]);

  return (
    <OverlayFrame
      title="Selection"
      onClose={onClose}
      width={34}
      footer={
        <>
          <button type="button" className="ma-btn ma-btn--small" onClick={selectPrev} disabled={selectable.length === 0}>
            Prev
          </button>
          <button type="button" className="ma-btn ma-btn--small" onClick={selectNext} disabled={selectable.length === 0}>
            Next
          </button>
          <button type="button" className="ma-btn ma-btn--small" onClick={invertSelection} disabled={selectable.length === 0}>
            Invert
          </button>
          <button type="button" className="ma-btn ma-btn--small" onClick={selectAll} disabled={selectable.length === 0}>
            All
          </button>
          <button type="button" className="ma-btn ma-btn--small" onClick={clearSelection} disabled={selected.length === 0}>
            Clear
          </button>
        </>
      }
    >
      <div className="ma-muted">
        {selected.length === 0 ? "Aucun projecteur sélectionné." : `${selected.length} projecteur(s), dans l'ordre de sélection (phase des phasers) :`}
      </div>
      <ol className="sh-sel">
        {selected.map((f, i) => (
          <li key={f.id} className="sh-sel__row">
            <span className="sh-sel__order">{i + 1}</span>
            <span className="sh-sel__fid ma-mono">{f.fid}</span>
            <span className="sh-sel__name ma-ellipsis">{f.name}</span>
            <span className="sh-sel__room ma-muted">{f.room ?? ""}</span>
            <button type="button" className="ma-btn ma-btn--small" onClick={() => select([f.id], "remove")} aria-label={`Retirer ${f.name}`}>
              −
            </button>
          </li>
        ))}
      </ol>
      {patch.some((f) => f.locked !== null) ? (
        <div className="ma-dim ma-row">
          <IconLock /> Les projecteurs verrouillés (chambre) ne sont jamais sélectionnables.
        </div>
      ) : null}
    </OverlayFrame>
  );
}
