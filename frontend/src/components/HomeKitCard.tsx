// Carte d'etat du pont HomeKit affichee dans les Reglages.
// Montre si le pont est actif, le QR Code et le PIN d'appairage (pairing) pour
// ajouter le pont dans l'app Maison, ainsi que le nombre de projecteurs exposes.
// Ne fait qu'afficher : le statut vient du backend (hook react-query parent).
import { QRCodeCanvas } from "qrcode.react";
import { HomeKitStatus } from "../lib/api";

type HomeKitCardProps = {
  status?: HomeKitStatus;
  isLoading: boolean;
  error?: Error | null;
};

export const HomeKitCard = ({ status, isLoading, error }: HomeKitCardProps) => {
  // Nombre de projecteurs RGB reellement exposes comme ampoules HomeKit.
  const exportedCount = status?.fixtures?.length ?? 0;
  // HomeKit est-il active cote backend (variable HOMEKIT_ENABLED) ?
  const enabled = status?.enabled ?? false;

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h2>HomeKit bridge</h2>
          <p className="muted">Expose les fixtures RGB en ampoules HomeKit</p>
        </div>
        {/* Badge d'etat : "Actif" si le pont tourne, "Activable" s'il est autorise
            mais pas encore demarre, "Desactive" si HomeKit est coupe. */}
        <span className="badge">{enabled ? (status?.started ? "Actif" : "Activable") : "Désactivé"}</span>
      </div>

      {/* Etats de chargement et d'erreur du statut HomeKit. */}
      {isLoading ? <p className="muted">Chargement du statut…</p> : null}
      {error ? <p className="muted">Erreur HomeKit : {error.message}</p> : null}

      {/* Une fois le statut charge sans erreur, deux cas possibles. */}
      {!isLoading && !error ? (
        <>
          {/* Cas 1 : HomeKit desactive. On explique comment l'activer cote backend. */}
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
            // Cas 2 : HomeKit actif. On affiche le QR Code d'appairage et les infos du pont.
            <div className="homekit-body">
              <div className="homekit-qr">
                {/* QR Code genere depuis l'URI de setup HAP : a scanner dans l'app Maison. */}
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
