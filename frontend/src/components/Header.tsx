type HeaderProps = {
  wsBadge: string;
};

export const Header = ({ wsBadge }: HeaderProps) => (
  <header className="header">
    <div className="title">
      <div className="badge">LightBridgeDMX · Mac mini</div>
      <h1>HomeKit ↔ DMX Bridge</h1>
      <p>Monitor the DMX universe, manage fixtures, and keep HomeKit in sync.</p>
    </div>
    <div className="flex-between">
      <div className="badge-pill">WS: {wsBadge}</div>
    </div>
  </header>
);
