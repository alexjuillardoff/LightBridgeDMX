// Cartes d'etat du tableau de bord (Dashboard).
// Affiche en lecture seule un resume de l'etat courant : univers DMX (FPS, canaux
// actifs, dernier tick), nombre de projecteurs (fixtures), nombre de scenes et
// derniere ligne d'activite recue du backend.
import { UniverseState } from "@lightbridgedmx/shared";

type StatusCardsProps = {
  universeState: UniverseState | null;
  activeChannels: number;
  fixturesCount: number;
  scenesCount: number;
  log: string;
};

// Grille de 4 cartes de synthese. Composant purement presentationnel :
// toutes les valeurs arrivent par les props, aucune logique ni etat local.
export const StatusCards = ({ universeState, activeChannels, fixturesCount, scenesCount, log }: StatusCardsProps) => (
  <section className="grid" aria-label="Status cards">
    {/* Carte Univers : affiche les donnees du flux temps reel si on a recu un etat,
        sinon un message d'attente tant que le WebSocket n'a rien pousse. */}
    <div className="card">
      <h2>Universe</h2>
      {universeState ? (
        <>
          <p>
            FPS: <strong>{universeState.fps}</strong>
          </p>
          <p>
            Active channels: <strong>{activeChannels}</strong>
          </p>
          {/* Heure du dernier tick (battement) de la boucle DMX, format local. */}
          <p className="muted">Tick: {new Date(universeState.timestamp).toLocaleTimeString()}</p>
        </>
      ) : (
        <p className="muted">Waiting for data…</p>
      )}
    </div>

    {/* Carte Projecteurs : nombre total de fixtures enregistres. */}
    <div className="card">
      <h2>Fixtures</h2>
      <p>
        Total: <strong>{fixturesCount}</strong>
      </p>
      <p className="muted">Overlap protection and HomeKit export planned.</p>
    </div>

    {/* Carte Scenes : nombre total de scenes enregistrees (etats rappelables). */}
    <div className="card">
      <h2>Scenes</h2>
      <p>
        Total: <strong>{scenesCount}</strong>
      </p>
      <p className="muted">Capture states and recall from the UI.</p>
    </div>

    {/* Carte Activite : derniere ligne de log poussee par le backend.
        Affiche "Ready" tant qu'aucun message n'est arrive. */}
    <div className="card">
      <h2>Activity</h2>
      <p>{log || "Ready"}</p>
      <p className="muted">Live logs from backend</p>
    </div>
  </section>
);
