// Chassis de l'interface, pense comme la surface d'un pupitre grandMA :
//
//   ┌ barre d'etat (univers, sortie DMX, programmer, horloge, blackout) ┐
//   │ barre de vues (Live / Patch / Setup)                              │
//   │ ecran (la vue active)            │ rail de touches                │
//   │ ligne de commande                                                 │
//   └ navigation basse (mobile uniquement)                              ┘
//
// La destination active (vue + volet de Patch) est lue/ecrite dans le hash de
// l'URL (useHashTab), donc un rafraichissement ou un lien partage rouvre la
// meme vue au meme volet.
import { Suspense, lazy, useCallback, useEffect } from "react";
import { PatchPage } from "../pages/PatchPage";
import { SetupPage } from "../pages/SetupPage";
import { BottomNav } from "./BottomNav";
import { CommandLine } from "./CommandLine";
import { KeypadRail } from "./KeypadRail";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { PatchPaneId, Route, TABS, TabId } from "./tabs";
import { useHashTab } from "./useHashTab";

// La vue Live est chargee a la demande (lazy) : c'est la plus lourde (plan de
// travail, fenetres, pools) et elle est inutile tant qu'on ne l'ouvre pas.
const LivePage = lazy(() => import("../pages/LivePage"));

// Affiche pendant le telechargement du chunk de la vue Live.
const PageFallback = () => (
  <div className="card">
    <h2>Chargement</h2>
    <p className="muted">Préparation de la console…</p>
  </div>
);

export const AppShell = () => {
  const [route, navigate] = useHashTab();

  // Changement de vue depuis la barre du haut ou la navigation mobile : on
  // laisse le volet de Patch a sa valeur par defaut.
  const selectTab = useCallback((tab: TabId) => navigate({ tab }), [navigate]);
  // Changement de volet depuis les pastilles de la vue Patch.
  const selectPane = useCallback(
    (pane: PatchPaneId) => navigate({ tab: "patch", pane }),
    [navigate]
  );

  // Choisit le composant de vue a afficher.
  const renderPage = (current: Route) => {
    switch (current.tab) {
      case "patch":
        return <PatchPage pane={current.pane} onPaneChange={selectPane} />;
      case "setup":
        return <SetupPage />;
      case "live":
      default:
        return (
          <Suspense fallback={<PageFallback />}>
            <LivePage />
          </Suspense>
        );
    }
  };

  // Titre de l'onglet du navigateur, mis a jour a chaque changement de vue.
  useEffect(() => {
    const tab = TABS.find((t) => t.id === route.tab);
    if (!tab) return;
    document.title = `${tab.label} · LightBridgeDMX`;
  }, [route.tab]);

  return (
    <div className="ma-desk">
      <StatusBar />
      <TabBar active={route.tab} onSelect={selectTab} />
      {/* Corps : l'ecran a gauche, le rail de touches a droite (masque sous
          1280 px, ou la place manque). */}
      <div className="ma-body">
        <main className="ma-screen" id={`panel-${route.tab}`}>
          {renderPage(route)}
        </main>
        <KeypadRail />
      </div>
      <CommandLine />
      <BottomNav active={route.tab} onSelect={selectTab} />
    </div>
  );
};
