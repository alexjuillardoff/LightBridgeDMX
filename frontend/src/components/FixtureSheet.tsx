// "Fixture Sheet" : la vue signature d'un pupitre grandMA.
// Une cellule par projecteur, avec son numero, son nom, son niveau de dimmer en
// pourcent, une barre de niveau et la pastille de couleur RGB courante.
//
// Cliquer une cellule l'ajoute ou la retire de la selection (cadre jaune). La
// selection est ensuite la cible de la barre d'encodeurs et de la ligne de
// commande : c'est le "programmer" du pupitre.
import { useMemo } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useSelection } from "../contexts/SelectionContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { readAttr, readRgb, toPct } from "../lib/programmer";

export const FixtureSheet = () => {
  const { fixtures } = useAppData();
  const { universeState } = useUniverseState();
  const { selectedIds, isSelected, toggle, select, clear } = useSelection();

  // Valeurs live des 512 canaux (tableau de zeros tant que rien n'est recu).
  const values = useMemo(() => universeState?.values ?? new Array(512).fill(0), [universeState]);

  return (
    <div className="card">
      <h2>
        Fixture Sheet
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          {selectedIds.length ? `${selectedIds.length} sélectionné(s)` : "aucune sélection"}
        </span>
      </h2>

      <div className="flex-between" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Cliquez une cellule pour la sélectionner — les encodeurs et la ligne de commande agissent dessus.
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="button-small"
            onClick={() => select(fixtures.map((f) => f.id))}
            disabled={!fixtures.length}
          >
            Tout
          </button>
          <button type="button" className="button-small" onClick={clear} disabled={!selectedIds.length}>
            Clear
          </button>
        </div>
      </div>

      {!fixtures.length ? (
        <p className="muted">Aucun projecteur patché. Ajoutez-en depuis la vue Projecteurs.</p>
      ) : (
        <div className="ma-sheet">
          {fixtures.map((fixture, index) => {
            // Le numero affiche (1, 2, 3...) est celui qu'on tape dans la ligne
            // de commande : "FIX 2" vise la deuxieme cellule.
            const number = index + 1;
            const level = readAttr(fixture, "dimmer", values);
            const pct = toPct(level);
            const swatch = readRgb(fixture, values);
            const selected = isSelected(fixture.id);
            return (
              <button
                key={fixture.id}
                type="button"
                aria-pressed={selected}
                className={`ma-cell ${selected ? "ma-cell-selected" : ""}`}
                onClick={() => toggle(fixture.id)}
              >
                <span className="ma-cell-top">
                  <span className="ma-cell-id">{String(number).padStart(3, "0")}</span>
                  {/* Pastille de couleur : seulement pour les projecteurs RGB. */}
                  {swatch ? <span className="ma-cell-swatch" style={{ background: swatch }} /> : null}
                </span>
                <span className="ma-cell-name">{fixture.name}</span>
                <span className={`ma-cell-value ${pct === 0 ? "ma-cell-value-zero" : ""}`}>{pct}</span>
                <span className="ma-cell-bar">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="ma-cell-meta">
                  A{String(fixture.address).padStart(3, "0")} · {fixture.channels.length} ch
                  {fixture.room ? ` · ${fixture.room}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
