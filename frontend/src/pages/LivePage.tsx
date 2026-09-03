// Vue "Live" : l'écran principal du pupitre.
// De haut en bas, on retrouve l'organisation d'un grandMA :
//   1. le bandeau d'encodeurs (attributs de la sélection) ;
//   2. la Fixture Sheet (sélection des projecteurs) ;
//   3. la Fader View (les 512 canaux, page par page) ;
//   4. le Mode Dance (chenillard) et la rangée d'executors.
// Une barre d'ancres permet de sauter d'une section à l'autre.
import { useCallback } from "react";
import { ChannelGrid } from "../components/ChannelGrid";
import { DancePanel } from "../components/DancePanel";
import { EncoderBar } from "../components/EncoderBar";
import { FixtureSheet } from "../components/FixtureSheet";
import { ScenesSection } from "../components/ScenesSection";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";

// Fait défiler l'écran jusqu'à la section demandée (barre d'ancres).
const scrollToAnchor = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
};

const LivePage = () => {
  const { fixtures, fixtureColors, scenes, mutations, handleUpdateChannel } = useAppData();
  const { universeState } = useUniverseState();

  const goSheet = useCallback(() => scrollToAnchor("live-sheet"), []);
  const goConsole = useCallback(() => scrollToAnchor("live-console"), []);
  const goDance = useCallback(() => scrollToAnchor("live-dance"), []);
  const goExec = useCallback(() => scrollToAnchor("live-exec"), []);

  return (
    <>
      <div className="section-title">
        <h2>Live</h2>
        <span className="muted">Encoders · Fixture Sheet · Fader View · Dance · Executors</span>
      </div>

      <nav className="anchor-nav" aria-label="Navigation de la vue Live">
        <button type="button" className="pill" onClick={goSheet}>
          Fixtures
        </button>
        <button type="button" className="pill" onClick={goConsole}>
          Faders
        </button>
        <button type="button" className="pill" onClick={goDance}>
          Dance
        </button>
        <button type="button" className="pill" onClick={goExec}>
          Executors
        </button>
      </nav>

      {/* 1. Encodeurs : agissent sur la sélection courante. */}
      <section className="live-section">
        <EncoderBar />
      </section>

      {/* 2. Fixture Sheet : c'est ici qu'on sélectionne les projecteurs. */}
      <section id="live-sheet" className="live-section">
        <FixtureSheet />
      </section>

      {/* 3. Fader View : accès canal par canal à l'univers DMX. */}
      <section id="live-console" className="live-section">
        <ChannelGrid
          universeState={universeState}
          fixtures={fixtures}
          fixtureColors={fixtureColors}
          onUpdate={handleUpdateChannel}
          error={mutations.setChannel.error as Error | null | undefined}
        />
      </section>

      {/* 4a. Mode Dance : chenillard strobe coordonné par pièce. */}
      <section id="live-dance" className="live-section">
        <div className="section-title">
          <h2>Dance</h2>
          <span className="muted">Strobe coordonné par pièce avec patterns spatiaux</span>
        </div>
        <div className="grid">
          <DancePanel />
        </div>
      </section>

      {/* 4b. Executors : scènes rappelables. */}
      <section id="live-exec" className="live-section">
        <ScenesSection scenes={scenes} />
      </section>
    </>
  );
};

export default LivePage;
