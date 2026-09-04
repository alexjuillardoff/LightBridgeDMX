// Éditeur de LIGNES, le cœur de la fenêtre — l'équivalent du tableau de l'Effect
// Editor d'un grandMA2 : une ligne par attribut visé, ses colonnes en face.
//
// C'est ce que l'ancienne fenêtre ne savait pas faire : elle n'éditait que la
// première ligne et annonçait les autres en note de bas de page, si bien qu'un
// cercle de lyre (pan + tilt déphasés de 90°) était affiché mais inréglable.
//
// Deux règles d'ergonomie tenues ici :
//  • un champ qui n'agit pas est grisé plutôt que muet — Width, Attack, Decay et
//    Seed ne veulent rien dire sur un sinus, seules les formes à fronts durs les
//    utilisent (c'est aussi la règle du pupitre, qui ne les propose que là) ;
//  • la ligne sélectionnée est celle dont l'aperçu trace la forme d'onde, et celle
//    que visent les raccourcis de phase.
import { Copy, Plus, Trash2 } from "lucide-react";
import { EffectAttribute, EffectForm, EffectLine } from "@lightbridgedmx/shared";
import {
  ATTRIBUTE_GROUP,
  ATTRIBUTE_LABELS,
  FORM_LABELS,
  NEW_LINE,
  isHardEdged
} from "./labels";

type Props = {
  lines: EffectLine[];
  selected: number;
  onSelect: (index: number) => void;
  onPatch: (index: number, patch: Partial<EffectLine>) => void;
  onAdd: (line: EffectLine) => void;
  onRemove: (index: number) => void;
};

// Le schéma partagé plafonne un effet à 8 lignes ; l'UI le dit au lieu de laisser
// le backend refuser la neuvième.
const MAX_LINES = 8;

export const EffectLines = ({ lines, selected, onSelect, onPatch, onAdd, onRemove }: Props) => {
  // Colonne Seed : elle n'apparaît que si une ligne tire au sort, sinon elle
  // occupe de la largeur pour une valeur qui ne sert à rien.
  const showSeed = lines.some((l) => l.form === "random");
  const line = lines[Math.min(selected, lines.length - 1)];

  return (
    <section className="fx-block">
      <div className="fx-block-head">
        <span>Lignes</span>
        <div className="fx-block-actions">
          <button
            type="button"
            className="fx-mini"
            disabled={lines.length >= MAX_LINES}
            title="Dupliquer la ligne sélectionnée"
            onClick={() => onAdd({ ...line })}
          >
            <Copy size={11} aria-hidden="true" /> Dupliquer
          </button>
          <button
            type="button"
            className="fx-mini"
            disabled={lines.length >= MAX_LINES}
            title={lines.length >= MAX_LINES ? `${MAX_LINES} lignes au maximum` : "Ajouter une ligne"}
            onClick={() => onAdd({ ...NEW_LINE })}
          >
            <Plus size={11} aria-hidden="true" /> Ligne
          </button>
        </div>
      </div>

      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th className="fx-col-num">#</th>
              <th>Attribut</th>
              <th>Forme</th>
              <th title="Absolu : la forme remplace la valeur. Relatif : elle s'ajoute à la position de départ (le mode des lyres).">
                Mode
              </th>
              <th title="Valeur basse, en %">Low</th>
              <th title="Valeur haute, en %">High</th>
              <th title="Phase de la première cellule de la sélection, en degrés">Phase de</th>
              <th title="Phase de la dernière cellule. 0 → 360 = un cycle réparti sur la sélection, 0 → 0 = tout à l'unisson.">
                Phase à
              </th>
              <th title="Largeur de la portion haute du cycle (créneau et aléatoire)">Width</th>
              <th title="Adoucit le front montant (créneau et aléatoire)">Att</th>
              <th title="Adoucit le front descendant (créneau et aléatoire)">Dec</th>
              {showSeed ? <th title="Graine du tirage aléatoire">Seed</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const soft = !isHardEdged(l.form);
              return (
                <tr
                  key={i}
                  className={i === selected ? "fx-row-active" : ""}
                  onClick={() => onSelect(i)}
                >
                  <td className={`fx-col-num fx-attr-${ATTRIBUTE_GROUP[l.attribute]}`}>{i + 1}</td>
                  <td>
                    <select
                      value={l.attribute}
                      onChange={(e) => onPatch(i, { attribute: e.target.value as EffectAttribute })}
                    >
                      {(Object.keys(ATTRIBUTE_LABELS) as EffectAttribute[]).map((a) => (
                        <option key={a} value={a}>
                          {ATTRIBUTE_LABELS[a]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={l.form}
                      onChange={(e) => onPatch(i, { form: e.target.value as EffectForm })}
                    >
                      {(Object.keys(FORM_LABELS) as EffectForm[]).map((f) => (
                        <option key={f} value={f}>
                          {FORM_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={l.mode}
                      onChange={(e) =>
                        onPatch(i, { mode: e.target.value as "absolute" | "relative" })
                      }
                    >
                      <option value="absolute">Absolu</option>
                      <option value="relative">Relatif</option>
                    </select>
                  </td>
                  <Num value={l.low} min={0} max={100} onChange={(v) => onPatch(i, { low: v })} />
                  <Num value={l.high} min={0} max={100} onChange={(v) => onPatch(i, { high: v })} />
                  <Num
                    value={l.phaseFrom}
                    min={-1440}
                    max={1440}
                    step={15}
                    onChange={(v) => onPatch(i, { phaseFrom: v })}
                  />
                  <Num
                    value={l.phaseTo}
                    min={-1440}
                    max={1440}
                    step={15}
                    onChange={(v) => onPatch(i, { phaseTo: v })}
                  />
                  <Num
                    value={l.width}
                    min={1}
                    max={100}
                    disabled={soft}
                    onChange={(v) => onPatch(i, { width: v })}
                  />
                  <Num
                    value={l.attack ?? 0}
                    min={0}
                    max={100}
                    disabled={soft}
                    onChange={(v) => onPatch(i, { attack: v })}
                  />
                  <Num
                    value={l.decay ?? 0}
                    min={0}
                    max={100}
                    disabled={soft}
                    onChange={(v) => onPatch(i, { decay: v })}
                  />
                  {showSeed ? (
                    <Num
                      value={l.seed ?? 1}
                      min={0}
                      max={65535}
                      disabled={l.form !== "random"}
                      onChange={(v) => onPatch(i, { seed: v })}
                    />
                  ) : null}
                  <td>
                    <button
                      type="button"
                      className="fx-mini fx-mini-danger"
                      disabled={lines.length <= 1}
                      title={lines.length <= 1 ? "Un effet garde au moins une ligne" : "Supprimer"}
                      onClick={() => onRemove(i)}
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Raccourcis de phase : les trois répartitions qu'on pose 90 % du temps.
          Les taper à la main (0 → 360, 0 → 0…) est exact mais fastidieux. */}
      <div className="fx-quickrow">
        <span className="fx-quicklabel">Phase ligne {selected + 1}</span>
        <button
          type="button"
          className="fx-mini"
          title="Toutes les cellules jouent ensemble"
          onClick={() => onPatch(selected, { phaseFrom: 0, phaseTo: 0 })}
        >
          Unisson
        </button>
        <button
          type="button"
          className="fx-mini"
          title="Un cycle complet réparti sur la sélection : l'effet défile"
          onClick={() => onPatch(selected, { phaseFrom: 0, phaseTo: 360 })}
        >
          Cycle
        </button>
        <button
          type="button"
          className="fx-mini"
          title="Un demi-cycle : dégradé d'un bout à l'autre, sans repli"
          onClick={() => onPatch(selected, { phaseFrom: 0, phaseTo: 180 })}
        >
          ½ cycle
        </button>
        <button
          type="button"
          className="fx-mini"
          title="Décale d'un quart de cycle — le déphasage d'un cercle de lyre (pan/tilt)"
          onClick={() =>
            onPatch(selected, { phaseFrom: line.phaseFrom + 90, phaseTo: line.phaseTo + 90 })
          }
        >
          +90°
        </button>
        <button
          type="button"
          className="fx-mini"
          title="Inverse le sens de défilement de cette ligne"
          onClick={() => onPatch(selected, { phaseFrom: line.phaseTo, phaseTo: line.phaseFrom })}
        >
          Inverser
        </button>
      </div>
    </section>
  );
};

/** Cellule de tableau portant un champ numérique borné. Une saisie vide donne NaN :
 *  on l'ignore plutôt que d'envoyer au backend une config qu'il refusera. */
const Num = ({
  value,
  min,
  max,
  step,
  disabled,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) => (
  <td>
    <input
      type="number"
      className="fx-num"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      disabled={disabled}
      title={disabled ? "Sans effet sur cette forme (créneau et aléatoire seulement)" : undefined}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
    />
  </td>
);
