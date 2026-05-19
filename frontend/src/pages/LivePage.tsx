import { useCallback } from "react";
import { ChannelGrid } from "../components/ChannelGrid";
import { DancePanel } from "../components/DancePanel";
import { ScenesSection } from "../components/ScenesSection";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";

const scrollToAnchor = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
};

const LivePage = () => {
  const { fixtures, fixtureColors, scenes, mutations, handleUpdateChannel } = useAppData();
  const { universeState } = useUniverseState();

  const goConsole = useCallback(() => scrollToAnchor("live-console"), []);
  const goDance = useCallback(() => scrollToAnchor("live-dance"), []);
  const goScenes = useCallback(() => scrollToAnchor("live-scenes"), []);

  return (
    <>
      <div className="section-title">
        <h2>Live</h2>
        <span className="muted">Console DMX · Mode Dance · Scènes</span>
      </div>

      <nav className="anchor-nav" aria-label="Navigation live">
        <button type="button" className="pill" onClick={goConsole}>
          Console DMX
        </button>
        <button type="button" className="pill" onClick={goDance}>
          Mode Dance
        </button>
        <button type="button" className="pill" onClick={goScenes}>
          Scènes
        </button>
      </nav>

      <section id="live-console" className="live-section">
        <ChannelGrid
          universeState={universeState}
          fixtures={fixtures}
          fixtureColors={fixtureColors}
          onUpdate={handleUpdateChannel}
          error={mutations.setChannel.error as Error | null | undefined}
        />
      </section>

      <section id="live-dance" className="live-section">
        <div className="section-title">
          <h2>Mode Dance</h2>
          <span className="muted">Strobe coordonné par pièce avec patterns spatiaux</span>
        </div>
        <div className="grid">
          <DancePanel />
        </div>
      </section>

      <section id="live-scenes" className="live-section">
        <div className="section-title">
          <h2>Scènes</h2>
          <span className="muted">Capture et rappel des cues de show (à venir)</span>
        </div>
        <ScenesSection scenes={scenes} />
      </section>
    </>
  );
};

export default LivePage;
