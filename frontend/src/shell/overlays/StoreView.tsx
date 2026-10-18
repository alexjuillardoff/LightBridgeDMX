// Overlay « Store View » (appui long / clic droit sur un bouton de la view bar) :
// nom de la vue, Store View (photographie les fenêtres courantes), Delete View, Cancel.
import { useState } from "react";
import type { FormEvent } from "react";
import { closeOverlay, deleteView, storeView, useWorkspace } from "../../state/workspace";
import { toast } from "../Toasts";
import { OverlayFrame } from "./OverlayFrame";

export type StoreViewPayload = { index: number };

export function isStoreViewPayload(p: unknown): p is StoreViewPayload {
  return typeof p === "object" && p !== null && typeof (p as StoreViewPayload).index === "number";
}

export function StoreView({ index }: { index: number }) {
  const existing = useWorkspace((s) => s.views[index] ?? null);
  const [name, setName] = useState(existing?.name ?? `View ${index + 1}`);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const store = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    storeView(index, trimmed);
    toast(`Vue ${index + 1} enregistrée : ${trimmed}`, "ok");
    closeOverlay();
  };
  const remove = () => {
    deleteView(index);
    toast(`Vue ${index + 1} supprimée`, "ok");
    closeOverlay();
  };

  return (
    <OverlayFrame
      title={`View ${index + 1}`}
      onClose={closeOverlay}
      width={26}
      footer={
        <>
          {existing ? (
            confirmDelete ? (
              <button type="button" className="ma-btn ma-btn--small ma-btn--danger ma-btn--active" onClick={remove}>
                Confirmer la suppression
              </button>
            ) : (
              <button type="button" className="ma-btn ma-btn--small ma-btn--danger" onClick={() => setConfirmDelete(true)}>
                Delete View
              </button>
            )
          ) : null}
          <button type="button" className="ma-btn ma-btn--small" onClick={closeOverlay}>
            Cancel
          </button>
          <button type="button" className="ma-btn ma-btn--small ma-btn--active" onClick={() => store()}>
            Store View
          </button>
        </>
      }
    >
      <form onSubmit={store} className="ma-col">
        <label className="ma-field">
          <span className="ma-field__label">Nom de la vue</span>
          <input className="ma-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={24} aria-label="Nom de la vue" />
        </label>
        <p className="ma-dialog__text">
          {existing
            ? `Store View remplace « ${existing.name} » par les fenêtres actuellement affichées.`
            : "Store View photographie les fenêtres actuellement affichées dans ce bouton."}
        </p>
      </form>
    </OverlayFrame>
  );
}
