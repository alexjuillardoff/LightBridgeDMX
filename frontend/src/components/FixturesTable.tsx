// Tableau listant les projecteurs (fixtures) configures : nom, adresse DMX,
// univers, canaux et bouton de suppression. Affiche un badge "HomeKit" quand le
// projecteur est expose dans l'app Maison. Composant d'affichage pur : il recoit
// tout via ses props et delegue la suppression au parent.
import { Fixture } from "@lightbridgedmx/shared";

type FixturesTableProps = {
  fixtures: Fixture[];
  onDelete: (fixture: Fixture) => void;
  isDeleting: boolean;
  deletingId?: string;
  error?: Error | null;
  homekitFixtureIds?: Set<string>;
  homekitEnabled?: boolean;
};

// Determine si un projecteur serait expose en RGB sur HomeKit. Sert de
// repli pour afficher le badge quand la liste reelle des projecteurs HomeKit
// n'est pas encore connue cote backend.
// Regles : explicitement desactive -> non ; canaux DMX HomeKit forces -> oui ;
// sinon il faut posseder les trois capabilities r, g et b.
const isRgbFixture = (fixture: Fixture) => {
  if (fixture.homekit?.enabled === false) return false;
  if (fixture.homekit?.dmxChannels) return true;
  const caps = fixture.channels.map((ch) => ch.capability);
  return caps.includes("r") && caps.includes("g") && caps.includes("b");
};

export const FixturesTable = ({
  fixtures,
  onDelete,
  isDeleting,
  deletingId,
  error,
  homekitFixtureIds,
  homekitEnabled
}: FixturesTableProps) => {
  if (!fixtures.length) {
    return <p className="muted">No fixtures yet.</p>;
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Addr</th>
            <th>Universe</th>
            <th>Channels</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {fixtures.map((fixture) => (
            <tr key={fixture.id}>
              <td data-label="Name">
                <div className="flex-between" style={{ gap: 6, alignItems: "center" }}>
                  <span>{fixture.name}</span>
                  {/* Badge HomeKit : visible si le pont est actif ET soit ce
                      projecteur figure dans la liste HomeKit fournie, soit
                      (liste absente) on devine via isRgbFixture en repli. */}
                  {homekitEnabled !== false &&
                  (homekitFixtureIds?.has(fixture.id) || (!homekitFixtureIds?.size && isRgbFixture(fixture))) ? (
                    <span className="badge-pill">HomeKit</span>
                  ) : null}
                </div>
                {fixture.profile ? (
                  <small className="muted">
                    QXF · {fixture.profile.manufacturer} {fixture.profile.model} · {fixture.profile.mode}
                  </small>
                ) : null}
              </td>
              <td data-label="Addr">{fixture.address}</td>
              <td data-label="Universe">{fixture.universe}</td>
              <td data-label="Channels">
                <div>{fixture.channels.length} ch</div>
                <small className="muted">
                  {fixture.channels.map((ch) => `${ch.channel}:${ch.name ?? ch.capability}`).join(", ")}
                </small>
              </td>
              <td data-label="Actions">
                <div className="table-actions">
                  <button
                    type="button"
                    className="button-danger button-small"
                    onClick={() => onDelete(fixture)}
                    disabled={isDeleting && deletingId === fixture.id}
                  >
                    {isDeleting && deletingId === fixture.id ? "Suppression…" : "Supprimer"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <small>Suppression impossible: {error.message}</small> : null}
    </>
  );
};
