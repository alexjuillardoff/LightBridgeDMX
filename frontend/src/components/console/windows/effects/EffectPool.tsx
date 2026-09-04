// Pool d'effets : les points de départ, posés sur des emplacements numérotés.
//
// Même grammaire que les autres pools du pupitre (Executors, Groups, Presets) :
// un clic sur la tuile la CHARGE dans l'éditeur, le bandeau Go la LANCE sur la
// sélection. La distinction compte — on veut pouvoir regarder un effet, le régler,
// puis l'envoyer, sans l'avoir déjà mis sur le plateau.
//
// Les effets qui s'appuient sur la géométrie 3D d'un bandeau sont grisés quand la
// sélection n'en a pas : lancer « Vague verticale » sur trois PAR donnerait un
// résultat muet (la distribution spatiale est ignorée faute de coordonnées), et
// c'est le genre de silence qu'on met une heure à comprendre.
import { Play } from "lucide-react";
import { DMX_EFFECT_PRESETS, DmxEffectPreset } from "@lightbridgedmx/shared";
import { GROUP_LABELS, describeEffect } from "./labels";

type Props = {
  group: DmxEffectPreset["group"];
  onGroup: (group: DmxEffectPreset["group"]) => void;
  /** Preset chargé dans l'éditeur, mis en avant dans la grille. */
  activeId: string | null;
  /** true si la sélection porte des coordonnées 3D (un bandeau avec son layout). */
  hasGeometry: boolean;
  canRun: boolean;
  onLoad: (preset: DmxEffectPreset) => void;
  onGo: (preset: DmxEffectPreset) => void;
};

const GROUPS: DmxEffectPreset["group"][] = ["pupitre", "3d", "meuble"];

export const EffectPool = ({
  group,
  onGroup,
  activeId,
  hasGeometry,
  canRun,
  onLoad,
  onGo
}: Props) => (
  <>
    {/* Onglets de groupe numérotés, comme la rangée du haut de l'Encoder Bar. */}
    <div className="ma-grouptabs">
      {GROUPS.map((g, i) => (
        <button
          key={g}
          type="button"
          aria-pressed={g === group}
          className={`ma-grouptab ${g === group ? "ma-grouptab-active" : ""}`}
          onClick={() => onGroup(g)}
        >
          <span className="ma-grouptab-num">{i + 1}</span>
          {GROUP_LABELS[g]}
        </button>
      ))}
    </div>

    <div className="pool-grid fx-pool">
      {DMX_EFFECT_PRESETS.map((preset, index) => {
        if (preset.group !== group) return null;
        const blocked = preset.needsGeometry && !hasGeometry;
        const classes = [
          "pool-tile",
          "pool-tile-effect",
          preset.id === activeId ? "pool-tile-active" : "",
          blocked ? "pool-tile-blocked" : ""
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={preset.id}
            className={classes}
            title={blocked ? `${preset.hint}\n\nCet effet suit la géométrie 3D d'un bandeau : sélectionne le bandeau pour qu'il ait un sens.` : preset.hint}
          >
            <span className="pool-num">{index + 1}</span>
            <button type="button" className="fx-tile-load" onClick={() => onLoad(preset)}>
              <span className="pool-name">{preset.label}</span>
              <span className="pool-meta">{describeEffect(preset.effect)}</span>
            </button>
            <button
              type="button"
              className="pool-go"
              disabled={!canRun}
              title={canRun ? "Lancer sur la sélection" : "Sélection vide"}
              onClick={() => onGo(preset)}
            >
              <Play size={11} strokeWidth={3} aria-hidden="true" /> Go
            </button>
          </div>
        );
      })}
    </div>
  </>
);
