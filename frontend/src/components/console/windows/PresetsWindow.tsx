// Pool de presets : des valeurs de canaux mémorisées et réapplicables.
//
// Différence avec un executor, qui prête à confusion si on ne la pose pas :
//  - un EXECUTOR mémorise un état de projecteurs (bloc de canaux par projecteur)
//    et se rejoue avec un master d'intensité ;
//  - un PRESET mémorise une carte canal → valeur brute, réappliquée telle quelle.
// Le preset sert aux valeurs « de référence » qu'on repose souvent : une teinte,
// une position de lyre, une ouverture de faisceau.
//
// Les deux vivent côté backend (`/api/presets`), qui savait déjà les enregistrer
// et les appliquer sans qu'aucune UI ne le propose.
import { Save } from "lucide-react";
import { PRESET_SLOTS, useConsole } from "../../../contexts/ConsoleContext";
import { useCommand } from "../../../contexts/CommandContext";
import { useSelection } from "../../../contexts/SelectionContext";

export const PresetsWindow = () => {
  const { presets, storePreset, applyPreset, busy } = useConsole();
  const { report } = useCommand();
  const { selectedIds } = useSelection();

  const onStore = (slot: number) => {
    if (!selectedIds.length) {
      report({ level: "warn", text: "Sélection vide — sélectionnez des projecteurs avant Store" });
      return;
    }
    const name = window.prompt(
      `Mémoriser les canaux des ${selectedIds.length} projecteur(s) sélectionné(s) dans le preset ${slot + 1}.\nNom du preset :`,
      `Preset ${slot + 1}`
    );
    if (name === null) return;
    void storePreset(slot, name).then(report);
  };

  const slots = Math.max(PRESET_SLOTS, presets.length);

  return (
    <div className="pool">
      <p className="pool-hint">
        Clic = application · <strong>Store</strong>{" "}
        {selectedIds.length
          ? `relève les canaux des ${selectedIds.length} projecteur(s) sélectionné(s)`
          : "relève les canaux de la sélection — vide pour l'instant"}
        .
      </p>

      <div className="pool-grid">
        {Array.from({ length: slots }, (_, slot) => {
          const preset = presets[slot];

          if (!preset) {
            return (
              <button
                key={`empty-${slot}`}
                type="button"
                className="pool-tile pool-tile-empty"
                disabled={busy}
                onClick={() => onStore(slot)}
                title={`Preset ${slot + 1} libre — mémoriser ici`}
              >
                <span className="pool-num">{slot + 1}</span>
                <span className="pool-name">libre</span>
                <span className="pool-store">
                  <Save size={12} strokeWidth={2.4} aria-hidden="true" /> Store
                </span>
              </button>
            );
          }

          return (
            <div key={preset.id} className="pool-tile pool-tile-preset">
              <span className="pool-num">{slot + 1}</span>
              <span className="pool-name" title={preset.name}>
                {preset.name}
              </span>
              <span className="pool-meta">{Object.keys(preset.payload).length} canaux</span>
              <button
                type="button"
                className="pool-go"
                disabled={busy}
                onClick={() => void applyPreset(slot).then(report)}
              >
                Appliquer
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
