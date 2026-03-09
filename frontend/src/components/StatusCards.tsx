import { UniverseState } from "@lightbridgedmx/shared";

type StatusCardsProps = {
  universeState: UniverseState | null;
  activeChannels: number;
  fixturesCount: number;
  scenesCount: number;
  log: string;
};

export const StatusCards = ({ universeState, activeChannels, fixturesCount, scenesCount, log }: StatusCardsProps) => (
  <section className="grid" aria-label="Status cards">
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
          <p className="muted">Tick: {new Date(universeState.timestamp).toLocaleTimeString()}</p>
        </>
      ) : (
        <p className="muted">Waiting for data…</p>
      )}
    </div>

    <div className="card">
      <h2>Fixtures</h2>
      <p>
        Total: <strong>{fixturesCount}</strong>
      </p>
      <p className="muted">Overlap protection and HomeKit export planned.</p>
    </div>

    <div className="card">
      <h2>Scenes</h2>
      <p>
        Total: <strong>{scenesCount}</strong>
      </p>
      <p className="muted">Capture states and recall from the UI.</p>
    </div>

    <div className="card">
      <h2>Activity</h2>
      <p>{log || "Ready"}</p>
      <p className="muted">Live logs from backend</p>
    </div>
  </section>
);
