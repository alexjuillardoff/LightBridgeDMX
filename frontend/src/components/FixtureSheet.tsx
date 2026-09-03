// "Fixture Sheet" : la vue signature d'un pupitre grandMA.
// Une cellule par projecteur, avec son numero, son nom, son niveau de dimmer en
// pourcent, une barre de niveau et la pastille de couleur RGB courante.
//
// Cliquer une cellule l'ajoute ou la retire de la selection (cadre jaune). La
// selection est ensuite la cible des encodeurs, de la ligne de commande et de
// STORE : c'est le "programmer" du pupitre.
//
// Les cellules sont regroupees par piece, comme les layers d'un pupitre : c'est
// le decoupage dont on se sert reellement ici ("monte le salon"), et il rend
// visible le fait qu'un projecteur n'est range nulle part.
//
// Le NUMERO affiche reste l'index global dans le patch, pas la position dans son
// groupe : "FIX 4" doit designer le meme projecteur qu'on affiche par piece ou a
// plat.
import { useMemo } from "react";
import { Lock } from "lucide-react";
import { Fixture } from "@lightbridgedmx/shared";
import { useAppData } from "../contexts/AppDataContext";
import { useSelection } from "../contexts/SelectionContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { lockReason } from "../lib/fixtureGuard";
import { readAttr, readRgb, toPct } from "../lib/programmer";

// Libelle de la section des projecteurs sans piece renseignee.
const UNASSIGNED = "Non assigné";

export const FixtureSheet = () => {
  const { fixtures } = useAppData();
  const { universeState } = useUniverseState();
  const { selectedIds, isSelected, toggle, select, clear } = useSelection();

  // Valeurs live des 512 canaux (tableau de zeros tant que rien n'est recu).
  const values = useMemo(() => universeState?.values ?? new Array(512).fill(0), [universeState]);

  // Regroupement par piece, en conservant le numero global de chaque projecteur.
  const rooms = useMemo(() => {
    const map = new Map<string, { fixture: Fixture; number: number }[]>();
    fixtures.forEach((fixture, index) => {
      const room = fixture.room?.trim() || UNASSIGNED;
      const bucket = map.get(room) ?? [];
      bucket.push({ fixture, number: index + 1 });
      map.set(room, bucket);
    });
    // Les projecteurs sans piece passent en dernier : ce sont les exceptions.
    return [...map.entries()].sort(([a], [b]) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b, "fr")
    );
  }, [fixtures]);

  // "Tout" ne prend que le selectionnable : les verrouilles sont ecartes en
  // amont, dans SelectionContext, mais autant ne pas les compter ici non plus.
  const selectableIds = useMemo(
    () => fixtures.filter((f) => !lockReason(f)).map((f) => f.id),
    [fixtures]
  );

  if (!fixtures.length) {
    return <p className="muted">Aucun projecteur patché. Ajoutez-en depuis la vue Patch.</p>;
  }

  return (
    <div className="sheet-wrap">
      <div className="sheet-toolbar">
        <span className="muted">
          {selectedIds.length ? `${selectedIds.length} sélectionné(s)` : "Aucune sélection"}
        </span>
        <div className="sheet-toolbar-keys">
          <button
            type="button"
            className="button-small"
            onClick={() => select(selectableIds)}
            disabled={!selectableIds.length}
          >
            Tout
          </button>
          <button type="button" className="button-small" onClick={clear} disabled={!selectedIds.length}>
            Clear
          </button>
        </div>
      </div>

      {rooms.map(([room, entries]) => (
        <div className="sheet-room" key={room}>
          <div className="sheet-room-title">
            {room}
            <span className="sheet-room-count">{entries.length}</span>
          </div>

          <div className="ma-sheet">
            {entries.map(({ fixture, number }) => {
              const level = readAttr(fixture, "dimmer", values);
              const pct = toPct(level);
              const swatch = readRgb(fixture, values);
              const selected = isSelected(fixture.id);
              const locked = lockReason(fixture);

              return (
                <button
                  key={fixture.id}
                  type="button"
                  aria-pressed={selected}
                  // Un projecteur verrouille reste lisible (on veut voir son
                  // niveau) mais refuse le clic : le garde-fou est visible, pas
                  // seulement silencieux.
                  aria-disabled={locked ? true : undefined}
                  title={locked ?? `${fixture.name} — cliquer pour sélectionner`}
                  className={`ma-cell ${selected ? "ma-cell-selected" : ""} ${locked ? "ma-cell-locked" : ""}`}
                  onClick={() => toggle(fixture.id)}
                >
                  <span className="ma-cell-top">
                    <span className="ma-cell-id">{String(number).padStart(3, "0")}</span>
                    {locked ? (
                      <Lock size={11} strokeWidth={2.6} aria-hidden="true" className="ma-cell-lock" />
                    ) : swatch ? (
                      // Pastille de couleur : seulement pour les projecteurs RGB.
                      <span className="ma-cell-swatch" style={{ background: swatch }} />
                    ) : null}
                  </span>
                  <span className="ma-cell-name">{fixture.name}</span>
                  <span className={`ma-cell-value ${pct === 0 ? "ma-cell-value-zero" : ""}`}>{pct}</span>
                  <span className="ma-cell-bar">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="ma-cell-meta">
                    A{String(fixture.address).padStart(3, "0")} · {fixture.channels.length} ch
                    {locked ? " · verrouillé" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
