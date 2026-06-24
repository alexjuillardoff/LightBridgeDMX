// Onglet Reglages : etat du pont HomeKit, configuration de la prise Meross,
// infos runtime du frontend, rappel des variables backend et maintenance (redemarrage).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { HomeKitCard } from "../components/HomeKitCard";
import { MerossCard } from "../components/MerossCard";
import { useAppData } from "../contexts/AppDataContext";
import { api, wsUrl } from "../lib/api";

// Base de l'API : variable d'env Vite si definie, sinon on passe par le proxy Vite vers :5000.
const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) || "(proxy Vite → :5000)";

export const SettingsPage = () => {
  const { homekitStatus, homekitStatusLoading, homekitStatusError, wsStatus, wsBadge } = useAppData();

  // Redemarrage complet de LightBridgeDMX (backend + frontend + QLC+).
  const restartMutation = useMutation(api.system.restart);
  const [restartRequested, setRestartRequested] = useState(false);

  const handleRestart = () => {
    if (!window.confirm("Redémarrer tout LightBridgeDMX (backend, frontend, QLC+) ? Le pilotage sera brièvement interrompu.")) {
      return;
    }
    setRestartRequested(true);
    restartMutation.mutate();
  };

  return (
    <>
      <div className="section-title">
        <h2>Réglages</h2>
        <span className="muted">HomeKit, prise Meross, système et maintenance</span>
      </div>
      <div className="grid">
        {/* Carte du pont HomeKit : etat, code d'appairage, accessoires exposes. */}
        <div className="card grid-span-full">
          <HomeKitCard status={homekitStatus} isLoading={homekitStatusLoading} error={homekitStatusError ?? undefined} />
        </div>

        {/* Carte de la prise Meross : configuration (IP, device key, canal) + etat. */}
        <MerossCard />

        {/* Infos runtime cote frontend : etat WebSocket, base API, mode dev/prod. */}
        <div className="card">
          <h2>Système</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Informations runtime côté frontend (les variables backend se règlent côté serveur).
          </p>
          <dl className="kv">
            <div>
              <dt>WebSocket</dt>
              <dd>
                {/* Badge vert (badge-on) seulement quand la connexion WebSocket est ouverte. */}
                <span className={`badge ${wsStatus === "open" ? "badge-on" : ""}`}>{wsBadge}</span>
                <small className="muted" style={{ marginLeft: 8 }}>
                  <code>{wsUrl()}</code>
                </small>
              </dd>
            </div>
            <div>
              <dt>API base</dt>
              <dd>
                <code>{apiBase}</code>
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{import.meta.env.DEV ? "Développement" : "Production"}</dd>
            </div>
          </dl>
        </div>

        {/* Rappel des variables backend. Valeurs affichees en dur ici : elles ne
            sont pas lues dynamiquement, elles servent juste de pense-bete a l'utilisateur. */}
        <div className="card">
          <h2>Variables backend</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Configuration du backend (lecture seule depuis l'UI — voir <code>backend/.env</code> ou le plist launchd).
          </p>
          <dl className="kv">
            <div>
              <dt>DMX output</dt>
              <dd>
                <code>artnet</code>
              </dd>
            </div>
            <div>
              <dt>Art-Net</dt>
              <dd>
                <code>192.168.0.200:6454 · univ 0</code>
              </dd>
            </div>
            <div>
              <dt>DMX FPS</dt>
              <dd>
                <code>30</code>
              </dd>
            </div>
            <div>
              <dt>HomeKit</dt>
              <dd>{homekitStatus?.enabled ? "activé" : "désactivé"}</dd>
            </div>
          </dl>
        </div>

        {/* Maintenance : redemarrage complet de LightBridgeDMX. */}
        <div className="card grid-span-full">
          <h2>Maintenance</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Redémarre les trois services (backend, frontend, QLC+) via launchd, par exemple pour appliquer une
            configuration changée hors UI.
          </p>
          <button className="btn-danger" onClick={handleRestart} disabled={restartMutation.isLoading || restartRequested}>
            {restartRequested ? "Redémarrage demandé…" : "Redémarrer LightBridgeDMX"}
          </button>
          {restartRequested ? (
            <p className="muted" style={{ marginTop: 8 }}>
              Redémarrage en cours. La page se reconnectera automatiquement d'ici quelques secondes.
            </p>
          ) : null}
          {restartMutation.error && !restartRequested ? (
            <p className="muted" style={{ marginTop: 8 }}>
              Échec : {(restartMutation.error as Error).message}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
};
