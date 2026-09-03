// Rail de touches à droite de l'écran : la surface de commande du pupitre.
//
// Il reprend la colonne de touches d'un grandMA2 onPC — touches de désignation
// (Fixture, Group), opérateurs (Thru, +, At), pavé numérique, touches de mémoire
// (Store, Go, Off), Please et B.O. — et chaque touche écrit dans la même ligne de
// commande que la saisie clavier.
//
// On ne met ici que des touches qui font réellement quelque chose : pas de
// décor inerte. C'est aussi pour ça que Store / Go / Off n'y figuraient pas
// avant — ils ne menaient nulle part tant que les executors n'existaient pas.
import { useAppData } from "../contexts/AppDataContext";
import { useCommand } from "../contexts/CommandContext";
import { useConsole } from "../contexts/ConsoleContext";
import { useSelection } from "../contexts/SelectionContext";

// Une touche du rail : libellé, action, et variante de couleur.
type KeyDef = {
  label: string;
  onPress: () => void;
  tone?: "amber" | "red" | "please" | "store";
  span?: boolean;
  title?: string;
};

const KeyButton = ({ def }: { def: KeyDef }) => (
  <button
    type="button"
    title={def.title}
    className={`ma-key ${
      def.tone === "amber"
        ? "ma-key-amber"
        : def.tone === "red"
        ? "ma-key-red"
        : def.tone === "please"
        ? "ma-key-please"
        : def.tone === "store"
        ? "ma-key-store"
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
  const { executors, groups } = useConsole();
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
    { label: "Group", onPress: () => append("group"), tone: "amber" },
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

  // Valeurs rapides.
  const valueKeys: KeyDef[] = [
    { label: "Full", onPress: () => runLine("full"), tone: "amber" },
    { label: "Out", onPress: () => runLine("out"), tone: "amber" }
  ];

  // Mémoire : ces trois touches préfixent la ligne, on complète par un numéro
  // puis Please — « Store 3 Please », exactement comme sur un pupitre.
  const memoryKeys: KeyDef[] = [
    {
      label: "Store",
      onPress: () => append("store"),
      tone: "store",
      title: "Store <n> Please — mémorise dans l'executor n"
    },
    { label: "Go", onPress: () => append("go"), tone: "amber", title: "Go <n> Please — rejoue l'executor n" },
    { label: "Off", onPress: () => append("off"), tone: "amber", title: "Off <n> Please — éteint l'executor n" }
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

      <div className="ma-rail-title">Mémoire</div>
      <div className="ma-keys-3">
        {memoryKeys.map((k) => (
          <KeyButton key={k.label} def={k} />
        ))}
      </div>

      <div className="ma-keys-3">
        <KeyButton def={{ label: "Please", onPress: submit, tone: "please", span: true }} />
        <KeyButton def={{ label: "B.O.", onPress: () => void handleBlackout(), tone: "red" }} />
      </div>

      <div className="ma-rail-title">Vues</div>
      <div className="ma-keys-3">
        <KeyButton def={{ label: "Live", onPress: () => runLine("goto live") }} />
        <KeyButton def={{ label: "Patch", onPress: () => runLine("goto patch") }} />
        <KeyButton def={{ label: "Réseau", onPress: () => runLine("goto inventaire") }} />
        <KeyButton def={{ label: "Setup", onPress: () => runLine("goto setup") }} />
        <KeyButton def={{ label: "Help", onPress: () => runLine("help") }} />
        <KeyButton def={{ label: "Update", onPress: () => void handleRefreshLibrary() }} />
      </div>

      {/* Rappel de l'état des pools, comme les compteurs de la surface MA. */}
      <div className="ma-rail-state">
        <span>Programmer</span>
        <strong>{selectedIds.length ? `${selectedIds.length} fixture(s)` : "vide"}</strong>
        <span>Executors</span>
        <strong>{executors.filter(Boolean).length} assigné(s)</strong>
        <span>Groupes</span>
        <strong>{groups.length}</strong>
      </div>
    </aside>
  );
};
