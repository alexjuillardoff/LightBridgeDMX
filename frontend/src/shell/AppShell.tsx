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

const LivePage = lazy(() => import("../pages/LivePage"));

const PageFallback = () => (
  <div className="card" style={{ marginTop: 16 }}>
    <p className="muted" style={{ margin: 0 }}>Chargement de la page…</p>
  </div>
);

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

export const AppShell = () => {
  const { wsBadge } = useAppData();
  const [active, setActive] = useHashTab();

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
