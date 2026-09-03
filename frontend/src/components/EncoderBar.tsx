// Bandeau d'encodeurs, calqué sur le haut d'écran d'un grandMA2 : une rangée
// d'onglets de groupe numérotés (1 Dimmer, 2 Color, 3 Position, 4 Beam) et,
// en dessous, les molettes avec leur boîte de valeur à liseré rouge.
//
// Les encodeurs agissent sur TOUS les projecteurs sélectionnés à la fois ; la
// valeur affichée est la plus haute de la sélection (convention HTP).
//
// Sous les molettes, une rangée de valeurs rapides (0 / 25 / 50 / 75 / Full)
// évite de faire tourner un encodeur au pixel près pour poser une valeur ronde —
// c'est le réflexe « At 50 Please » de la ligne de commande, à portée de clic.
import { useMemo, useState } from "react";
import { useAppData } from "../contexts/AppDataContext";
import { useSelection } from "../contexts/SelectionContext";
import { useUniverseState } from "../contexts/UniverseStateContext";
import { isLockedFixture } from "../lib/fixtureGuard";
import {
  ATTR_COLORS,
  ATTR_GROUPS,
  ATTR_LABELS,
  AttrGroupId,
  applyAttr,
  attrsForSelection,
  readAttrForSelection,
  toPct
} from "../lib/programmer";
import { MaKnob } from "./ma/MaKnob";

// Valeurs rapides proposées sous chaque encodeur, en pourcent.
const QUICK_VALUES = [0, 25, 50, 75, 100];

export const EncoderBar = () => {
  const { fixtures, handleUpdateChannel } = useAppData();
  const { universeState } = useUniverseState();
  const { selectedIds } = useSelection();
  // Groupe d'attributs affiché (équivalent des touches de groupe du pupitre).
  const [groupId, setGroupId] = useState<AttrGroupId>("dimmer");

  const values = useMemo(() => universeState?.values ?? new Array(512).fill(0), [universeState]);
  // Double garde : la sélection est déjà purgée des verrouillés, mais un
  // projecteur peut avoir été renommé « chambre » depuis qu'il a été sélectionné.
  const selected = useMemo(
    () => fixtures.filter((f) => selectedIds.includes(f.id) && !isLockedFixture(f)),
    [fixtures, selectedIds]
  );

  const group = ATTR_GROUPS.find((g) => g.id === groupId) ?? ATTR_GROUPS[0];
  // On ne montre que les attributs réellement présents sur la sélection.
  const attrs = useMemo(() => attrsForSelection(selected, group).slice(0, 4), [selected, group]);

  return (
    <div className="encoder-wrap">
      {/* Onglets de groupe numérotés, comme la rangée du haut sur MA2. */}
      <div className="ma-grouptabs">
        {ATTR_GROUPS.map((g, index) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={g.id === groupId}
            className={`ma-grouptab ${g.id === groupId ? "ma-grouptab-active" : ""}`}
            onClick={() => setGroupId(g.id)}
          >
            <span className="ma-grouptab-num">{index + 1}</span>
            {g.label}
          </button>
        ))}
      </div>

      {!selected.length ? (
        <div className="ma-encoder-empty">
          Sélectionnez un projecteur dans la Fixture Sheet, ou tapez <code>FIXTURE 1</code> puis Please
        </div>
      ) : !attrs.length ? (
        <div className="ma-encoder-empty">Aucun attribut « {group.label} » sur cette sélection</div>
      ) : (
        <div className="ma-encoders">
          {attrs.map((attr) => {
            const value = readAttrForSelection(selected, attr, values);
            const color = ATTR_COLORS[attr];
            return (
              <div key={attr} className="ma-encoder">
                {/* Boîte de valeur : "Dim   50.0", liseré rouge comme sur MA2. */}
                <div className="ma-encoder-box">
                  <span className="ma-encoder-label">{ATTR_LABELS[attr]}</span>
                  <span className="ma-encoder-value">{toPct(value).toFixed(1)}</span>
                </div>
                <MaKnob
                  label={`${ATTR_LABELS[attr]} de la sélection`}
                  value={value}
                  color={color}
                  onChange={(next) => applyAttr(selected, attr, next, handleUpdateChannel)}
                />

                <div className="ma-encoder-quick">
                  {QUICK_VALUES.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className="ma-encoder-quickbtn"
                      onClick={() =>
                        applyAttr(selected, attr, Math.round((pct / 100) * 255), handleUpdateChannel)
                      }
                    >
                      {pct === 100 ? "FL" : pct}
                    </button>
                  ))}
                </div>

                <span className="ma-cell-meta" style={{ textAlign: "center" }}>
                  {value} / 255 DMX
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
