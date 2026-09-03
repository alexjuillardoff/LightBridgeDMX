// Le plan de travail du pupitre : les fenêtres de la vue Live.
//
// Remplace l'ancienne page Live, qui empilait tout dans une colonne défilante
// avec une barre d'ancres pour se rattraper. Un pupitre ne défile pas : il pose
// des fenêtres sur un plan, et mémorise cet agencement dans des « Views »
// rappelables par leur numéro. C'est ce qu'on fait ici.
//
// Sous 1024 px, le plan de travail n'a aucun sens (on ne déplace pas des
// fenêtres au pouce sur un téléphone) : les mêmes fenêtres sont alors empilées
// en cartes, dans l'ordre de la disposition, et restent toutes utilisables.
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { useConsole } from "../../contexts/ConsoleContext";
import { useSelection } from "../../contexts/SelectionContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  ConsoleView,
  ConsoleWindow as WindowModel,
  ROW_PX,
  WINDOW_LABELS,
  WindowKind,
  clampWindow,
  freshDefaultViews,
  placeNewWindow
} from "../../lib/console/layout";
import { readLocal, writeLocal } from "../../lib/localStore";
import { ConsoleWindow } from "./ConsoleWindow";
import { renderWindowContent } from "./windows/registry";

const VIEWS_KEY = "views";
const ACTIVE_VIEW_KEY = "activeView";

// Marge de respiration sous la fenêtre la plus basse, pour pouvoir la saisir et
// l'agrandir même quand elle touche le bas du plan.
const BOTTOM_SLACK_ROWS = 4;

export const Workspace = () => {
  const compact = !useMediaQuery("(min-width: 1024px)");
  const { selectedIds } = useSelection();
  const { executors, groups, presets } = useConsole();

  const [views, setViews] = useState<ConsoleView[]>(() => {
    const stored = readLocal<ConsoleView[] | null>(VIEWS_KEY, null);
    if (!stored?.length) return freshDefaultViews();
    // Une disposition persistée par une version antérieure peut contenir des
    // fenêtres hors bornes, ou d'un type qui n'existe plus. On la repasse au
    // gabarit et on écarte l'inconnu, sinon un vieux localStorage ferait planter
    // le rendu (`WINDOW_LABELS[kind]` indéfini) sans moyen de s'en sortir.
    return stored.map((view) => ({
      ...view,
      windows: (view.windows ?? [])
        // La fenêtre « Dance » a été remplacée par la fenêtre Effets : on la
        // convertit au lieu de la jeter, sinon la View « Effets » déjà
        // enregistrée dans le navigateur se retrouverait vide.
        .map((w) => ((w?.kind as string) === "dance" ? { ...w, kind: "effects" as WindowKind } : w))
        .filter((w) => w?.kind in WINDOW_LABELS)
        .map(clampWindow)
    }));
  });
  const [activeId, setActiveId] = useState<string>(() =>
    readLocal<string>(ACTIVE_VIEW_KEY, "programmer")
  );
  // Ordre d'empilement : l'id de la dernière fenêtre touchée passe devant.
  const [stack, setStack] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => writeLocal(VIEWS_KEY, views), [views]);
  useEffect(() => writeLocal(ACTIVE_VIEW_KEY, activeId), [activeId]);

  const view = useMemo(
    () => views.find((v) => v.id === activeId) ?? views[0],
    [activeId, views]
  );
  const windows = view?.windows ?? [];

  // Applique une transformation aux fenêtres de la vue courante seulement :
  // déplacer une fenêtre dans « Programmer » ne doit pas bouger « Playback ».
  const updateWindows = useCallback(
    (transform: (list: WindowModel[]) => WindowModel[]) => {
      setViews((prev) =>
        prev.map((v) => (v.id === view?.id ? { ...v, windows: transform(v.windows) } : v))
      );
    },
    [view?.id]
  );

  const moveWindow = useCallback(
    (next: WindowModel) => updateWindows((list) => list.map((w) => (w.id === next.id ? next : w))),
    [updateWindows]
  );

  const closeWindow = useCallback(
    (id: string) => updateWindows((list) => list.filter((w) => w.id !== id)),
    [updateWindows]
  );

  const addWindow = useCallback(
    (kind: WindowKind) => {
      updateWindows((list) => [...list, placeNewWindow(list, kind)]);
      setAdding(false);
    },
    [updateWindows]
  );

  const resetView = useCallback(() => {
    const pristine = freshDefaultViews().find((v) => v.id === view?.id);
    if (!pristine) return;
    setViews((prev) => prev.map((v) => (v.id === pristine.id ? pristine : v)));
  }, [view?.id]);

  const focusWindow = useCallback((id: string) => {
    setStack((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((x) => x !== id), id]));
  }, []);

  // Badge de barre de titre : le chiffre qu'on veut voir sans ouvrir la fenêtre.
  const badgeFor = (kind: WindowKind): string | undefined => {
    switch (kind) {
      case "fixtures":
        return selectedIds.length ? `${selectedIds.length} sél.` : undefined;
      case "executors":
      case "playbacks":
        return `${executors.filter(Boolean).length}`;
      case "groups":
        return `${groups.length}`;
      case "presets":
        return `${presets.length}`;
      default:
        return undefined;
    }
  };

  // Hauteur du plan : juste ce qu'il faut pour la fenêtre la plus basse.
  const heightRows = windows.reduce((max, w) => Math.max(max, w.y + w.h), 0) + BOTTOM_SLACK_ROWS;

  // Types de fenêtres proposés à l'ajout : tous, y compris ceux déjà posés (on
  // peut vouloir deux Fixture Sheets côte à côte, filtrées différemment plus tard).
  const addable = Object.keys(WINDOW_LABELS) as WindowKind[];

  return (
    <div className="workspace-root">
      {/* Barre de vues du pupitre : rappel d'un agencement par son numéro. */}
      <div className="workspace-bar">
        <LayoutGrid size={13} strokeWidth={2.2} aria-hidden="true" />
        <span className="workspace-bar-label">Views</span>
        {views.map((v, index) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.id === view?.id}
            className={`workspace-view ${v.id === view?.id ? "workspace-view-active" : ""}`}
            onClick={() => setActiveId(v.id)}
          >
            <span className="workspace-view-num">{index + 1}</span>
            {v.name}
          </button>
        ))}

        <span className="workspace-bar-spacer" />

        {!compact ? (
          <>
            <button
              type="button"
              className="button-small"
              aria-expanded={adding}
              onClick={() => setAdding((prev) => !prev)}
            >
              <Plus size={12} strokeWidth={2.6} aria-hidden="true" /> Fenêtre
            </button>
            <button
              type="button"
              className="button-small"
              title="Rétablir la disposition d'origine de cette view"
              onClick={resetView}
            >
              <RotateCcw size={12} strokeWidth={2.6} aria-hidden="true" /> Reset
            </button>
          </>
        ) : (
          <span className="muted workspace-hint">Vues empilées — élargissez pour déplacer les fenêtres</span>
        )}
      </div>

      {adding && !compact ? (
        <div className="workspace-add" role="menu">
          {addable.map((kind) => (
            <button key={kind} type="button" role="menuitem" onClick={() => addWindow(kind)}>
              <strong>{WINDOW_LABELS[kind].title}</strong>
              <span className="muted">{WINDOW_LABELS[kind].hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      {compact ? (
        // Empilement mobile : mêmes fenêtres, dans l'ordre de lecture du plan.
        <div className="workspace-stack">
          {[...windows]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w) => (
              <section className="ma-win ma-win-static" key={w.id}>
                <header className="ma-win-title">
                  <span className="ma-win-name">{WINDOW_LABELS[w.kind].title}</span>
                  {badgeFor(w.kind) ? <span className="ma-win-badge">{badgeFor(w.kind)}</span> : null}
                </header>
                <div className="ma-win-body">{renderWindowContent(w.kind)}</div>
              </section>
            ))}
        </div>
      ) : (
        <div className="workspace" style={{ height: heightRows * ROW_PX }}>
          {windows.map((w) => (
            <ConsoleWindow
              key={w.id}
              win={w}
              title={WINDOW_LABELS[w.kind].title}
              badge={badgeFor(w.kind)}
              onChange={moveWindow}
              onClose={() => closeWindow(w.id)}
              onFocus={() => focusWindow(w.id)}
              // Les fenêtres jamais touchées gardent l'ordre du modèle ; celles
              // qu'on manipule remontent au-dessus.
              z={10 + stack.indexOf(w.id)}
            >
              {renderWindowContent(w.kind)}
            </ConsoleWindow>
          ))}

          {!windows.length ? (
            <p className="muted workspace-empty">
              Aucune fenêtre dans cette view — ajoutez-en une avec <strong>+ Fenêtre</strong>, ou
              rétablissez la disposition d'origine avec <strong>Reset</strong>.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};
