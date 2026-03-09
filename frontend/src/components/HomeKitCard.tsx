import { QRCodeCanvas } from "qrcode.react";
import { HomeKitStatus } from "../lib/api";

type HomeKitCardProps = {
  status?: HomeKitStatus;
  isLoading: boolean;
  error?: Error | null;
};

export const HomeKitCard = ({ status, isLoading, error }: HomeKitCardProps) => {
  const exportedCount = status?.fixtures?.length ?? 0;
  const enabled = status?.enabled ?? false;

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h2>HomeKit bridge</h2>
          <p className="muted">Expose les fixtures RGB en ampoules HomeKit</p>
        </div>
        <span className="badge">{enabled ? (status?.started ? "Actif" : "Activable") : "Désactivé"}</span>
      </div>

      {isLoading ? <p className="muted">Chargement du statut…</p> : null}
      {error ? <p className="muted">Erreur HomeKit : {error.message}</p> : null}

      {!isLoading && !error ? (
        <>
          {!enabled ? (
            <div>
              <p>HomeKit est désactivé. Définir <code>HOMEKIT_ENABLED=true</code> sur le backend puis relancer.</p>
              {status?.pin ? (
                <p className="muted">
                  PIN prévu : <strong>{status.pin}</strong>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="homekit-body">
              <div className="homekit-qr">
                {status?.setupUri ? (
                  <QRCodeCanvas value={status.setupUri} bgColor="transparent" fgColor="#e8f1ff" size={140} />
                ) : (
                  <p className="muted">QR Code indisponible pour le moment.</p>
                )}
              </div>
              <div className="homekit-meta">
                <p>
                  <strong>{status?.name}</strong>
                </p>
                <p className="muted">
                  PIN : <strong>{status?.pin}</strong>
                </p>
                <p className="muted">
                  Username : <code>{status?.username}</code>
                </p>
                <p className="muted">
                  Fixtures exportées : <strong>{exportedCount}</strong>
                </p>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
