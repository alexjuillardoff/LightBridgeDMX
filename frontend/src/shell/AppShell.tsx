// Shell principal de l'application React.
// Assemble la coquille de l'UI : en-tete, barre d'onglets (TabBar),
// contenu de l'onglet actif et navigation basse (BottomNav, mobile).
// L'onglet courant est lu/ecrit dans le hash de l'URL via useHashTab.
import { Suspense, lazy, useEffect } from "react";
import { Header } from "../components/Header";
import { useAppData } from "../contexts/AppDataContext";
import { DashboardPage } from "../pages/DashboardPage";
import { FixturesPage } from "../pages/FixturesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SmartLightsPage } from "../pages/SmartLightsPage";
import { BottomNav } from "./BottomNav";
import { TabBar } from "./TabBar";
import { TABS, TabId } from "./tabs";
import { useHashTab } from "./useHashTab";

// La page Live est chargee a la demande (lazy) : elle est lourde
// (console DMX temps reel) et inutile tant qu'on ne l'ouvre pas.
const LivePage = lazy(() => import("../pages/LivePage"));

// Affiche pendant que le chunk lazy de la page Live se telecharge.
const PageFallback = () => (
  <div className="card" style={{ marginTop: 16 }}>
    <p className="muted" style={{ margin: 0 }}>Chargement de la page…</p>
  </div>
);

// Choisit le composant de page a afficher selon l'onglet actif.
// L'onglet "live" est enveloppe dans Suspense car charge en lazy.
const renderPage = (tab: TabId) => {
  switch (tab) {
    case "dashboard":
      return <DashboardPage />;
    case "projecteurs":
      return <FixturesPage />;
    case "lampes":
      return <SmartLightsPage />;
    case "live":
      return (
        <Suspense fallback={<PageFallback />}>
          <LivePage />
        </Suspense>
      );
    case "reglages":
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
};

// Composant racine de l'interface.
// wsBadge : indicateur d'etat de la connexion WebSocket affiche dans l'en-tete.
// active : onglet courant, synchronise avec le hash de l'URL.
export const AppShell = () => {
  const { wsBadge } = useAppData();
  const [active, setActive] = useHashTab();

  // Met a jour le titre de l'onglet du navigateur a chaque changement d'onglet.
  useEffect(() => {
    const tab = TABS.find((t) => t.id === active);
    if (!tab) return;
    document.title = `${tab.label} · LightBridgeDMX`;
  }, [active]);

  return (
    <>
      <main className="app-main" id={`panel-${active}`}>
        <Header wsBadge={wsBadge} />
        <TabBar active={active} onSelect={setActive} />
        <div className="app-content">{renderPage(active)}</div>
      </main>
      <BottomNav active={active} onSelect={setActive} />
    </>
  );
};
