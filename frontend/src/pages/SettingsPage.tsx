import { HomeKitCard } from "../components/HomeKitCard";
import { useAppData } from "../contexts/AppDataContext";
import { wsUrl } from "../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) || "(proxy Vite → :5000)";

export const SettingsPage = () => {
  const { homekitStatus, homekitStatusLoading, homekitStatusError, wsStatus, wsBadge } = useAppData();

  return (
    <>
      <div className="section-title">
        <h2>Réglages</h2>
        <span className="muted">HomeKit, système et infos backend</span>
      </div>
      <div className="grid">
        <div className="card grid-span-full">
          <HomeKitCard status={homekitStatus} isLoading={homekitStatusLoading} error={homekitStatusError ?? undefined} />
        </div>

        <div className="card">
          <h2>Système</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Informations runtime côté frontend (les variables backend se règlent côté serveur).
          </p>
          <dl className="kv">
            <div>
              <dt>WebSocket</dt>
              <dd>
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
      </div>
    </>
  );
};
