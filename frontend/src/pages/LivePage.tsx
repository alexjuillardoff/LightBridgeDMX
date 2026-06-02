// Page "Live" : regroupe sur un seul ecran les trois outils de pilotage temps reel.
// Console DMX (curseurs des canaux), Mode Dance (chenillard strobe par piece)
// et Scenes (capture/rappel des cues). Une barre d'ancres permet de sauter d'une
// section a l'autre sans changer d'onglet.
import { useCallback } from "react";
import { ChannelGrid } from "../components/ChannelGrid";
import { DancePanel } from "../components/DancePanel";
import { ScenesSection } from "../components/ScenesSection";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";

// Fait defiler la page en douceur jusqu'a la section dont l'id est passe en argument.
// Sert a la barre d'ancres (boutons Console / Dance / Scenes). Sort sans rien faire
// si aucun element ne porte cet id.
const scrollToAnchor = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
};

const LivePage = () => {
  // Donnees partagees : liste des projecteurs (fixtures), couleurs associees,
  // scenes enregistrees, et les mutations API (dont la mise a jour d'un canal).
  const { fixtures, fixtureColors, scenes, mutations, handleUpdateChannel } = useAppData();
  // Etat live des 512 canaux de l'univers DMX, pousse par WebSocket.
  const { universeState } = useUniverseState();

  // Raccourcis de navigation vers chaque section. useCallback evite de recreer
  // ces fonctions a chaque rendu (les handlers restent stables).
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

      {/* Section Console DMX : grille de curseurs pour piloter chaque canal a la main. */}
      <section id="live-console" className="live-section">
        <ChannelGrid
          universeState={universeState}
          fixtures={fixtures}
          fixtureColors={fixtureColors}
          onUpdate={handleUpdateChannel}
          error={mutations.setChannel.error as Error | null | undefined}
        />
      </section>

      {/* Section Mode Dance : declenche le chenillard strobe coordonne par piece. */}
      <section id="live-dance" className="live-section">
        <div className="section-title">
          <h2>Mode Dance</h2>
          <span className="muted">Strobe coordonné par pièce avec patterns spatiaux</span>
        </div>
        <div className="grid">
          <DancePanel />
        </div>
      </section>

      {/* Section Scenes : capture et rappel des cues (tops de show). Fonction a venir. */}
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
