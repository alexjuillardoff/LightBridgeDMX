// Dialogue « Add Window » (comme MA3) : catégories à gauche (Common, Presets, Pools,
// Playback, Tools, Data, More) et tuiles des fenêtres de la catégorie. Un clic ajoute la
// fenêtre à la vue courante, à l'endroit cliqué sur l'écran si on vient de là.
import { useState } from "react";
import type { WindowKind } from "../state/workspace";
import { closeOverlay } from "../state/workspace";
import { WINDOWS, openWindow } from "../windows/registry";
import type { WindowModule } from "../windows/types";
import { IconWindow } from "./icons";
import { OverlayFrame } from "./overlays/OverlayFrame";

type Category = WindowModule["category"];
const CATEGORIES: Category[] = ["Common", "Presets", "Pools", "Playback", "Tools", "Data", "More"];

export type AddWindowPayload = { x: number; y: number } | undefined;

export function AddWindowDialog({ at }: { at?: { x: number; y: number } }) {
  const modules = Object.values(WINDOWS) as WindowModule[];
  // Première catégorie non vide par défaut.
  const [cat, setCat] = useState<Category>(() => CATEGORIES.find((c) => modules.some((m) => m.category === c)) ?? "Common");
  const tiles = modules.filter((m) => m.category === cat);

  const add = (kind: WindowKind) => {
    openWindow(kind, at);
    closeOverlay();
  };

  return (
    <OverlayFrame title="Add Window" onClose={closeOverlay} width={46} className="sh-addwin">
      <div className="sh-addwin__layout">
        <div className="sh-addwin__cats" role="tablist" aria-label="Catégories">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === cat}
              className={`ma-btn sh-addwin__cat${c === cat ? " ma-btn--active" : ""}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="sh-addwin__tiles" role="tabpanel">
          {tiles.length === 0 ? <div className="ma-empty">Aucune fenêtre dans cette catégorie.</div> : null}
          {tiles.map((m) => (
            <button key={m.kind} type="button" className="ma-btn sh-addwin__tile" onClick={() => add(m.kind)} title={`Ajouter « ${m.title} »`}>
              <IconWindow />
              <span>{m.title}</span>
            </button>
          ))}
        </div>
      </div>
    </OverlayFrame>
  );
}
