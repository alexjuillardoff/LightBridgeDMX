import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power, RefreshCw, Square } from "lucide-react";
import { DanceState } from "@lightbridgedmx/shared";
import { useAppData } from "../contexts/AppDataContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { countActiveChannels } from "../lib/fixtures";
import { api } from "../lib/api";
import { setActiveTabHash } from "../shell/navigate";

const NAV_LINK_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: "6px 12px",
  borderRadius: 999,
  cursor: "pointer",
  fontSize: 12
};

export const DashboardPage = () => {
  const {
    fixtures,
    scenes,
    homekitStatus,
    homekitStatusLoading,
    logMessage,
    logHistory,
    handleBlackout,
    handleRefreshLibrary,
    mutations
  } = useAppData();
  const { universeState } = useUniverseState();
  const queryClient = useQueryClient();

  const danceQuery = useQuery<DanceState>(["dance", "state"], api.dance.state, { refetchInterval: 1500 });
  const stopDance = useMutation<DanceState, Error, void>(() => api.dance.stop(), {
    onSuccess: (state) => queryClient.setQueryData(["dance", "state"], state)
  });
  const danceRunning = danceQuery.data?.running ?? false;

  const activeChannels = countActiveChannels(universeState);
  const fps = universeState?.fps ?? 0;
  const tick = universeState ? new Date(universeState.timestamp).toLocaleTimeString() : "—";

  return (
    <>
      <div className="section-title">
        <h2>Tableau de bord</h2>
        <span className="muted">État global du pont DMX ↔ HomeKit</span>
      </div>

      <section className="grid dashboard-grid" aria-label="Status">
        <div className="card">
          <h2>Universe</h2>
          {universeState ? (
            <>
              <p>
                FPS : <strong>{fps}</strong>
              </p>
              <p>
                Canaux actifs : <strong>{activeChannels}</strong> / 512
              </p>
              <p className="muted">Dernier tick : {tick}</p>
            </>
          ) : (
            <p className="muted">En attente du flux DMX…</p>
          )}
        </div>

        <div className="card">
          <h2>Projecteurs</h2>
          <p>
            Total : <strong>{fixtures.length}</strong>
          </p>
          <button type="button" style={NAV_LINK_STYLE} onClick={() => setActiveTabHash("projecteurs")}>
            Gérer →
          </button>
        </div>

        <div className="card">
          <h2>Scènes</h2>
          <p>
            Total : <strong>{scenes.length}</strong>
          </p>
          <button type="button" style={NAV_LINK_STYLE} onClick={() => setActiveTabHash("live")}>
            Voir Live →
          </button>
        </div>

        <div className="card">
          <h2>HomeKit</h2>
          {homekitStatusLoading ? (
            <p className="muted">Chargement…</p>
          ) : !homekitStatus?.enabled ? (
            <>
              <p>
                État : <span className="badge">Désactivé</span>
              </p>
              <p className="muted" style={{ fontSize: 12 }}>
                Définir <code>HOMEKIT_ENABLED=true</code> côté backend.
              </p>
            </>
          ) : (
            <>
              <p>
                État :{" "}
                <span className={`badge ${homekitStatus.started ? "badge-on" : ""}`}>
                  {homekitStatus.started ? "Actif" : "Activable"}
                </span>
              </p>
              <p className="muted">
                Fixtures exportées : <strong>{homekitStatus.fixtures.length}</strong>
              </p>
              <button type="button" style={NAV_LINK_STYLE} onClick={() => setActiveTabHash("reglages")}>
                QR & PIN →
              </button>
            </>
          )}
        </div>

        <div className="card">
          <h2>Mode Dance</h2>
          <p>
            État :{" "}
            <span className={`badge ${danceRunning ? "badge-on" : ""}`}>
              {danceRunning ? `▶ En cours · ${danceQuery.data?.phasesSent ?? 0} phases` : "■ Arrêté"}
            </span>
          </p>
          {danceRunning ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Pattern : <strong>{danceQuery.data?.currentPattern ?? "—"}</strong>
            </p>
          ) : null}
          <button type="button" style={NAV_LINK_STYLE} onClick={() => setActiveTabHash("live")}>
            Ouvrir Live →
          </button>
        </div>

        <div className="card quick-actions">
          <h2>Actions rapides</h2>
          <div className="quick-actions-grid">
            <button type="button" className="btn-danger" onClick={() => void handleBlackout()}>
              <Power size={16} strokeWidth={2} aria-hidden="true" />
              <span>Blackout</span>
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => stopDance.mutate()}
              disabled={!danceRunning || stopDance.isLoading}
            >
              <Square size={16} strokeWidth={2} aria-hidden="true" />
              <span>{stopDance.isLoading ? "Arrêt…" : "Stop Dance"}</span>
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleRefreshLibrary()}
              disabled={mutations.refreshLibrary.isLoading}
            >
              <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
              <span>{mutations.refreshLibrary.isLoading ? "Refresh…" : "Refresh QXF"}</span>
            </button>
          </div>
        </div>

        <div className="card activity-card">
          <h2>Activité récente</h2>
          {logHistory.length === 0 ? (
            <p className="muted">{logMessage || "Backend prêt"}</p>
          ) : (
            <ul className="activity-list">
              {logHistory.map((entry, idx) => (
                <li key={`${entry.timestamp}-${idx}`} className={`activity-item activity-${entry.level}`}>
                  <span className="activity-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className="activity-msg">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
};
