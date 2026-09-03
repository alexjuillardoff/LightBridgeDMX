// Rail de touches à droite de l'écran : la surface de commande du pupitre.
//
// Il reprend la colonne de touches d'un grandMA2 onPC — touches de fonction
// (Fixture, Group, Thru, At…), pavé numérique, Please, Clear, B.O. — et chaque
// touche écrit dans la même ligne de commande que la saisie clavier.
//
// On ne met ici que des touches qui font réellement quelque chose : pas de
// décor inerte.
import { useAppData } from "../contexts/AppDataContext";
import { useCommand } from "../contexts/CommandContext";
import { useSelection } from "../contexts/SelectionContext";

// Une touche du rail : libellé, action, et variante de couleur.
type KeyDef = {
  label: string;
  onPress: () => void;
  tone?: "amber" | "red" | "please";
  span?: boolean;
};

const KeyButton = ({ def }: { def: KeyDef }) => (
  <button
    type="button"
    className={`ma-key ${
      def.tone === "amber"
        ? "ma-key-amber"
        : def.tone === "red"
        ? "ma-key-red"
        : def.tone === "please"
        ? "ma-key-please"
        : ""
    } ${def.span ? "ma-key-wide" : ""}`}
    onClick={def.onPress}
  >
    {def.label}
  </button>
);

export const KeypadRail = () => {
  const { input, setInput, append, backspace, submit, runLine } = useCommand();
  const { selectedIds, clear } = useSelection();
  const { handleBlackout, handleRefreshLibrary } = useAppData();

  // Touche Clear : efface la saisie en cours si elle existe, sinon vide la
  // sélection — le réflexe d'un opérateur qui appuie deux fois sur Clear.
  const onClear = () => {
    if (input.trim()) {
      setInput("");
      return;
    }
    clear();
  };

  // Touches de désignation (haut du rail).
  const targetKeys: KeyDef[] = [
    { label: "Fixture", onPress: () => append("fixture"), tone: "amber" },
    { label: "Channel", onPress: () => append("channel"), tone: "amber" },
    { label: "All", onPress: () => runLine("all"), tone: "amber" }
  ];

  // Opérateurs de la syntaxe MA.
  const operatorKeys: KeyDef[] = [
    { label: "Thru", onPress: () => append("thru"), tone: "amber" },
    { label: "+", onPress: () => append("+"), tone: "amber" },
    { label: "At", onPress: () => append("at"), tone: "amber" }
  ];

  // Pavé numérique, disposition pupitre (7 8 9 / 4 5 6 / 1 2 3 / 0 . ⌫).
  const digitKeys: KeyDef[] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "."].map((d) => ({
    label: d,
    onPress: () => append(d)
  }));

  // Valeurs rapides et exécution.
  const valueKeys: KeyDef[] = [
    { label: "Full", onPress: () => runLine("full"), tone: "amber" },
    { label: "Out", onPress: () => runLine("out"), tone: "amber" }
  ];

  return (
    <aside className="ma-rail" aria-label="Touches du pupitre">
      <div className="ma-rail-title">Sélection</div>
      <div className="ma-keys-3">
        {targetKeys.map((k) => (
          <KeyButton key={k.label} def={k} />
        ))}
      </div>

      <div className="ma-rail-title">Syntaxe</div>
      <div className="ma-keys-3">
        {operatorKeys.map((k) => (
          <KeyButton key={k.label} def={k} />
        ))}
      </div>

      <div className="ma-rail-title">Clavier</div>
      <div className="ma-keys-3">
        {digitKeys.map((k) => (
          <KeyButton key={k.label} def={k} />
        ))}
        <KeyButton def={{ label: "⌫", onPress: backspace }} />
      </div>

      <div className="ma-keys-3">
        {valueKeys.map((k) => (
          <KeyButton key={k.label} def={k} />
        ))}
        <KeyButton def={{ label: "Clear", onPress: onClear }} />
      </div>

      <div className="ma-keys-3">
        <KeyButton def={{ label: "Please", onPress: submit, tone: "please", span: true }} />
        <KeyButton def={{ label: "B.O.", onPress: () => void handleBlackout(), tone: "red" }} />
      </div>

      <div className="ma-rail-title">Système</div>
      <div className="ma-keys-3">
        <KeyButton def={{ label: "Help", onPress: () => runLine("help") }} />
        <KeyButton def={{ label: "Patch", onPress: () => runLine("goto patch") }} />
        <KeyButton def={{ label: "Live", onPress: () => runLine("goto live") }} />
        <KeyButton def={{ label: "Setup", onPress: () => runLine("goto setup") }} />
        <KeyButton def={{ label: "Lights", onPress: () => runLine("goto lights") }} />
        <KeyButton def={{ label: "Update", onPress: () => void handleRefreshLibrary() }} />
      </div>

      {/* Rappel de l'état du programmer, comme le compteur de sélection MA. */}
      <div className="ma-rail-title">
        Programmer : {selectedIds.length ? `${selectedIds.length} fixture(s)` : "vide"}
      </div>
    </aside>
  );
};
