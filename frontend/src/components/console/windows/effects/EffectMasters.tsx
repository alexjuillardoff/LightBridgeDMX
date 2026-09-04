// Les réglages qui portent sur l'effet ENTIER, par opposition au tableau de lignes
// qui règle chaque attribut : vitesse, sens, MAtricks, couleurs, rendu.
//
// L'ordre est celui du geste : d'abord la vitesse (le réglage qu'on retouche en
// regardant le plateau), puis la répartition sur la sélection, puis les couleurs,
// puis le rendu — qu'on pose une fois et qu'on ne rouvre jamais.
import { DmxEffect, EffectAttribute } from "@lightbridgedmx/shared";
import { cyclesPerSecond, fromHex, toHex } from "./labels";

type Props = {
  effect: DmxEffect;
  onPatch: (patch: Partial<DmxEffect>) => void;
  onMatricks: (patch: Partial<NonNullable<DmxEffect["matricks"]>>) => void;
};

// Vitesses posées d'un clic : la ronde des BPM utiles, du fondu lent au strobe.
const SPEED_STEPS = [15, 30, 60, 120, 240];
const RATE_STEPS = [0.5, 1, 2, 4];

export const EffectMasters = ({ effect, onPatch, onMatricks }: Props) => {
  const attrs = new Set<EffectAttribute>(effect.lines.map((l) => l.attribute));
  // Les champs de couleur ne concernent que les cellules RGB sans canal d'intensité
  // — chaque zone d'un ruban. On ne les montre que si une ligne peut les employer.
  const usesFade = attrs.has("dimmer");
  const usesColor = attrs.has("color");
  const usesHue = attrs.has("hue");

  return (
    <>
      <section className="fx-block">
        <div className="fx-block-head">
          <span>Vitesse</span>
          <span className="fx-block-note">
            {cyclesPerSecond(effect).toFixed(2)} cycle/s ·{" "}
            {Math.round(effect.speed * effect.rate)} BPM effectifs
          </span>
        </div>

        <div className="fx-masters">
          <Master label="Speed" unit="BPM">
            <input
              type="number"
              value={effect.speed}
              min={0}
              max={1200}
              step={5}
              onChange={(e) => onPatch({ speed: clamp(e.target.value, 0, 1200, effect.speed) })}
            />
            <div className="fx-quickrow">
              {SPEED_STEPS.map((s) => (
                <button key={s} type="button" className="fx-mini" onClick={() => onPatch({ speed: s })}>
                  {s}
                </button>
              ))}
            </div>
          </Master>

          <Master label="Rate" unit="×" hint="Multiplicateur de vitesse, comme le Rate du pupitre : Rate 1 = la vitesse affichée.">
            <input
              type="number"
              value={effect.rate}
              min={0.05}
              max={20}
              step={0.05}
              onChange={(e) => onPatch({ rate: clamp(e.target.value, 0.05, 20, effect.rate) })}
            />
            <div className="fx-quickrow">
              {RATE_STEPS.map((r) => (
                <button key={r} type="button" className="fx-mini" onClick={() => onPatch({ rate: r })}>
                  ×{r}
                </button>
              ))}
            </div>
          </Master>

          <Master label="Sens" hint="Sens de défilement de la phase le long de la sélection.">
            <div className="fx-toggle">
              <button
                type="button"
                className={effect.direction === "forward" ? "fx-toggle-on" : ""}
                onClick={() => onPatch({ direction: "forward" })}
              >
                ▶ Avant
              </button>
              <button
                type="button"
                className={effect.direction === "backward" ? "fx-toggle-on" : ""}
                onClick={() => onPatch({ direction: "backward" })}
              >
                ◀ Arrière
              </button>
            </div>
          </Master>
        </div>
      </section>

      <section className="fx-block">
        <div className="fx-block-head">
          <span>MAtricks</span>
          <span className="fx-block-note">répartition de la phase sur les cellules</span>
        </div>
        <div className="fx-matricks">
          <Stepper
            label="Blocks"
            hint="N cellules voisines partagent la même phase."
            value={effect.matricks?.blocks ?? 1}
            min={1}
            max={100}
            onChange={(v) => onMatricks({ blocks: v })}
          />
          <Stepper
            label="Groups"
            hint="Le motif complet se répète N fois sur la sélection."
            value={effect.matricks?.groups ?? 1}
            min={1}
            max={50}
            onChange={(v) => onMatricks({ groups: v })}
          />
          <Stepper
            label="Wings"
            hint="La sélection est pliée en N ailes, une aile sur deux lue en miroir."
            value={effect.matricks?.wings ?? 1}
            min={1}
            max={8}
            onChange={(v) => onMatricks({ wings: v })}
          />
          <Stepper
            label="Interleave"
            hint="Une cellule sur N joue l'effet ; les autres sont laissées intactes."
            value={effect.matricks?.interleave ?? 1}
            min={1}
            max={16}
            onChange={(v) => onMatricks({ interleave: v })}
          />
        </div>
        {effect.spatial ? (
          <p className="fx-warn">
            Cet effet répartit la phase par la géométrie 3D du bandeau : Blocks et Wings sont
            ignorés (ils raisonnent en rang de cellule), Groups continue de répéter le motif.
          </p>
        ) : null}
      </section>

      {usesFade || usesColor || usesHue ? (
        <section className="fx-block">
          <div className="fx-block-head">
            <span>Couleurs</span>
            <span className="fx-block-note">cellules RGB sans canal d'intensité</span>
          </div>
          <div className="fx-colors">
            {usesFade ? (
              <>
                <Swatch
                  label="Fond"
                  hint="Couleur de la valeur basse d'une ligne Dimmer sur une cellule RGB."
                  value={toHex(effect.bgColor, "#000000")}
                  onChange={(c) => onPatch({ bgColor: fromHex(c) })}
                />
                <Swatch
                  label="Pleine"
                  hint="Couleur de la valeur haute d'une ligne Dimmer sur une cellule RGB."
                  value={toHex(effect.color, "#ffffff")}
                  onChange={(c) => onPatch({ color: fromHex(c) })}
                />
              </>
            ) : null}
            {usesColor ? (
              <>
                <Swatch
                  label="Départ"
                  hint="Couleur de départ du fondu d'une ligne « Couleur »."
                  value={toHex(effect.color, "#000000")}
                  onChange={(c) => onPatch({ color: fromHex(c) })}
                />
                <Swatch
                  label="Arrivée"
                  hint="Couleur d'arrivée du fondu d'une ligne « Couleur »."
                  value={toHex(effect.colorTo, "#ffffff")}
                  onChange={(c) => onPatch({ colorTo: fromHex(c) })}
                />
              </>
            ) : null}
            {usesHue ? (
              <>
                <Field label="Teinte de" hint="Degrés : 0 rouge, 120 vert, 240 bleu.">
                  <input
                    type="number"
                    value={effect.hueFrom ?? 0}
                    min={-720}
                    max={720}
                    step={15}
                    onChange={(e) =>
                      onPatch({ hueFrom: clamp(e.target.value, -720, 720, effect.hueFrom ?? 0) })
                    }
                  />
                </Field>
                <Field label="Teinte à" hint="360° d'écart = un arc-en-ciel complet.">
                  <input
                    type="number"
                    value={effect.hueTo ?? 360}
                    min={-720}
                    max={720}
                    step={15}
                    onChange={(e) =>
                      onPatch({ hueTo: clamp(e.target.value, -720, 720, effect.hueTo ?? 360) })
                    }
                  />
                </Field>
                <Field label="Saturation">
                  <input
                    type="number"
                    value={effect.saturation ?? 100}
                    min={0}
                    max={100}
                    onChange={(e) =>
                      onPatch({
                        saturation: clamp(e.target.value, 0, 100, effect.saturation ?? 100)
                      })
                    }
                  />
                </Field>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="fx-block">
        <div className="fx-block-head">
          <span>Rendu</span>
          <span className="fx-block-note">se pose une fois</span>
        </div>
        <div className="fx-render">
          <Field
            label="Courbe"
            hint="Correction de gradation des lignes d'intensité. Linéaire est le bon choix en 8 bits : une courbe carrée écrase le bas du fondu dans une poignée de valeurs."
          >
            <select
              value={effect.curve}
              onChange={(e) => onPatch({ curve: e.target.value as DmxEffect["curve"] })}
            >
              <option value="linear">Linéaire</option>
              <option value="square">Carrée (v²)</option>
              <option value="cube">Cubique (v³)</option>
            </select>
          </Field>
          <label className="fx-check" title="Alterne deux valeurs voisines pour simuler du 10 bits. À n'activer que sur un chemin direct : via QLC+, un maillon rééchantillonne la trame et le tramage ressort en battement lent.">
            <input
              type="checkbox"
              checked={effect.dither}
              onChange={(e) => onPatch({ dither: e.target.checked })}
            />
            <span>Tramage temporel</span>
          </label>
        </div>
      </section>
    </>
  );
};

// ── Petits blocs ───────────────────────────────────────────────────────────

const Master = ({
  label,
  unit,
  hint,
  children
}: {
  label: string;
  unit?: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="fx-master" title={hint}>
    <div className="ma-encoder-box">
      <span className="ma-encoder-label">{label}</span>
      {unit ? <span className="fx-master-unit">{unit}</span> : null}
    </div>
    {children}
  </div>
);

const Field = ({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="fx-field" title={hint}>
    <span>{label}</span>
    {children}
  </label>
);

const Swatch = ({
  label,
  hint,
  value,
  onChange
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) => (
  <label className="fx-field fx-swatch" title={hint}>
    <span>{label}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

const Stepper = ({
  label,
  hint,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) => (
  <div className="fx-stepper" title={hint}>
    <span className="fx-stepper-label">{label}</span>
    <div className="fx-stepper-row">
      <button
        type="button"
        className="fx-mini"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(e.target.value, min, max, value))}
      />
      <button
        type="button"
        className="fx-mini"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  </div>
);

/** Lecture d'un champ numérique : borne, et garde l'ancienne valeur si la saisie
 *  est vide (NaN) — sinon le champ se remplirait tout seul de 0 dès qu'on l'efface. */
const clamp = (raw: string, min: number, max: number, previous: number): number => {
  const v = Number(raw);
  if (!Number.isFinite(v)) return previous;
  return Math.min(max, Math.max(min, v));
};
