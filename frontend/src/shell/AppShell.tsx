// Chassis de l'interface, pense comme la surface d'un pupitre grandMA :
//
//   ┌ barre d'etat (univers, sortie DMX, programmer, horloge, blackout) ┐
//   │ barre de vues (Live / Patch / Reseau / Setup)                     │
//   │ ecran (la vue active)            │ rail de touches                │
//   │ ligne de commande                                                 │
//   └ navigation basse (mobile uniquement)                              ┘
//
// La vue active est lue/ecrite dans le hash de l'URL (useHashTab), donc un
// rafraichissement ou un lien partage rouvre la meme vue.
import { Suspense, lazy, useEffect } from "react";
import { NetworkPage } from "../pages/NetworkPage";
import { PatchPage } from "../pages/PatchPage";
import { SetupPage } from "../pages/SetupPage";
import { BottomNav } from "./BottomNav";
import { CommandLine } from "./CommandLine";
import { KeypadRail } from "./KeypadRail";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TABS, TabId } from "./tabs";
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

// Choisit le composant de vue a afficher.
const renderPage = (tab: TabId) => {
  switch (tab) {
    case "patch":
      return <PatchPage />;
    case "reseau":
      return <NetworkPage />;
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

export const AppShell = () => {
  const [active, setActive] = useHashTab();

  // Titre de l'onglet du navigateur, mis a jour a chaque changement de vue.
  useEffect(() => {
    const tab = TABS.find((t) => t.id === active);
    if (!tab) return;
    document.title = `${tab.label} · LightBridgeDMX`;
  }, [active]);

  return (
    <div className="ma-desk">
      <StatusBar />
      <TabBar active={active} onSelect={setActive} />
      {/* Corps : l'ecran a gauche, le rail de touches a droite (masque sous
          1280 px, ou la place manque). */}
      <div className="ma-body">
        <main className="ma-screen" id={`panel-${active}`}>
          {renderPage(active)}
        </main>
        <KeypadRail />
      </div>
      <CommandLine />
      <BottomNav active={active} onSelect={setActive} />
    </div>
  );
};
