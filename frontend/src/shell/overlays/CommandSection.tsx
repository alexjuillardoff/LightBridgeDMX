// Overlay « Command Section » : clavier virtuel MA3 qui alimente la command line
// (utile sur tablette). Les mots-clés s'ajoutent séparés par une espace ; Clear agit tout
// de suite, Esc vide la ligne, Please exécute.
import { useStore } from "../../lib/store";
import { runCommandLine } from "../../lib/command/execute";
import { closeOverlay } from "../../state/workspace";
import { appendCommandToken, commandLineStore, setCommandText, showCommandFeedback, submitCommandLine } from "../CommandLine";
import { OverlayFrame } from "./OverlayFrame";

type Key = { label: string; token?: string; action?: () => void; className?: string; wide?: boolean };

async function runImmediate(text: string): Promise<void> {
  showCommandFeedback(await runCommandLine(text));
}

const KEYWORDS: Key[][] = [
  [{ label: "Fixture" }, { label: "Group" }, { label: "Preset" }, { label: "Sequence" }, { label: "Executor" }, { label: "View" }],
  [{ label: "At" }, { label: "Full" }, { label: "Thru" }, { label: "+" }, { label: "-" }, { label: "Attribute" }],
  [
    { label: "Store", className: "is-store" },
    { label: "Delete", className: "is-danger" },
    { label: "Label" },
    { label: "Go", className: "is-go" },
    { label: "Off" },
    { label: "Help" }
  ],
  [
    { label: "Clear", className: "is-clear", action: () => void runImmediate("Clear") },
    { label: "Esc", action: () => setCommandText("") },
    { label: "Blackout", className: "is-danger" },
    { label: "Highlight" },
    { label: "Please", className: "is-please", action: submitCommandLine, wide: true }
  ]
];

const NUMPAD: Key[][] = [
  [{ label: "7" }, { label: "8" }, { label: "9" }],
  [{ label: "4" }, { label: "5" }, { label: "6" }],
  [{ label: "1" }, { label: "2" }, { label: "3" }],
  [{ label: "0" }, { label: "." }, { label: "⌫", action: () => setCommandText(commandLineStore.get().text.replace(/\s*\S*\s?$/, "")) }]
];

function KeyButton({ k }: { k: Key }) {
  return (
    <button
      type="button"
      className={`ma-btn sh-cs__key ${k.className ?? ""}${k.wide ? " sh-cs__key--wide" : ""}`}
      onClick={() => (k.action ? k.action() : appendCommandToken(k.token ?? k.label))}
    >
      {k.label}
    </button>
  );
}

export function CommandSection() {
  const text = useStore(commandLineStore, (s) => s.text);
  return (
    <OverlayFrame title="Command Section" onClose={closeOverlay} width={48} className="sh-cs">
      <div className="sh-cs__line" aria-live="polite">
        <span className="sh-cmd__prompt">
          Admin<span className="sh-cmd__kw">[Fixture]</span>&gt;
        </span>
        <span className="sh-cs__text">{text}</span>
        <span className="sh-cs__cursor" aria-hidden="true" />
      </div>
      <div className="sh-cs__layout">
        <div className="sh-cs__keywords">
          {KEYWORDS.map((row, i) => (
            <div key={i} className="sh-cs__row">
              {row.map((k) => (
                <KeyButton key={k.label} k={k} />
              ))}
            </div>
          ))}
        </div>
        <div className="sh-cs__numpad">
          {NUMPAD.map((row, i) => (
            <div key={i} className="sh-cs__row">
              {row.map((k) => (
                <KeyButton key={k.label} k={k} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </OverlayFrame>
  );
}
