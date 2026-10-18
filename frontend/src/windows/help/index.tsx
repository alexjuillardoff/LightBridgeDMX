// Fenêtre « Help » : liste des commandes (COMMAND_HELP), raccourcis clavier et rappel des
// gestes MA3 (Store armé, Clear ×3, appui long, déplacement et redimensionnement des fenêtres).
import { useMemo, useState } from "react";
import { COMMAND_HELP, GESTURE_HELP, SHORTCUT_HELP } from "../../lib/command/help";
import type { HelpEntry } from "../../lib/command/help";
import { focusCommandLine, setCommandText } from "../../shell/CommandLine";
import type { WindowModule } from "../types";
import "./style.css";

// Raccourcis : ceux du core (SHORTCUT_HELP) complétés par les gestes propres au chrome.
const EXTRA_SHORTCUTS: HelpEntry[] = [
  { syntax: "Échap (ligne non vide)", description: "Vide la ligne de commande ; ferme l'overlay ouvert" },
  { syntax: "Maj + glisser", description: "Molette d'encodeur en mode fin (×0,2)" },
  { syntax: "Alt + molette souris", description: "Encodeur : pas de 10" },
  { syntax: "Home / End", description: "Encodeur, fader, Grand Master : minimum / maximum" },
  { syntax: "Lettres / chiffres", description: "Vont dans la ligne de commande si aucun champ n'a le focus" }
];
const SHORTCUTS: HelpEntry[] = [...SHORTCUT_HELP, ...EXTRA_SHORTCUTS];

// Gestes propres au chrome, en complément de GESTURE_HELP (core).
const GESTURES: Array<{ title: string; text: string }> = [
  {
    title: "Fenêtres",
    text: "Glisser la barre de titre déplace la fenêtre ; le coin bas-droit la redimensionne ; tout s'accroche à la grille 24×16. Double-clic sur le titre : plein écran. Le carré « MA » ouvre Settings / Delete Window."
  },
  {
    title: "Encodeurs",
    text: "Glisser verticalement la molette (1 px = 1 DMX), molette de souris ou flèches. Clic sur la boîte : Calculator (0-9, %, Thru pour un fan sur la sélection, Full, Out, Please). Boîte rouge = valeur active dans le programmer."
  },
  {
    title: "Grand Master",
    text: "Glisser ou molette sur la colonne de droite de l'encoder bar ; clic sur son en-tête : Master Controls (Blackout, Highlight, Off All Phasers). Le master n'atténue que l'intensité et les couleurs."
  },
  {
    title: "View bar",
    text: "Clic : affiche la vue. Appui long ou clic droit : Store View (photographie les fenêtres affichées) ou Delete View."
  }
];

function HelpWindow() {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q.length === 0 ? COMMAND_HELP : COMMAND_HELP.filter((l) => `${l.syntax} ${l.description}`.toLowerCase().includes(q));
  }, [filter]);

  const tryCommand = (syntax: string) => {
    // Recopie la syntaxe dans la ligne de commande pour l'adapter.
    setCommandText(syntax.replace(/\s*\|.*$/, "").replace(/[[\]<>]/g, ""));
    focusCommandLine();
  };

  return (
    <div className="w-help">
      <section className="w-help__section">
        <header className="w-help__head">
          <h2>Commandes</h2>
          <input
            className="ma-input w-help__filter"
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrer les commandes"
          />
        </header>
        {shown.length === 0 ? <div className="ma-empty">Aucune commande ne correspond.</div> : null}
        <table className="ma-sheet w-help__table">
          <thead>
            <tr>
              <th>Syntaxe</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={`${l.syntax}-${i}`}>
                <td>
                  <button type="button" className="w-help__cmd ma-mono" onClick={() => tryCommand(l.syntax)} title="Recopier dans la ligne de commande">
                    {l.syntax}
                  </button>
                </td>
                <td className="w-help__desc">{l.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="w-help__section">
        <header className="w-help__head">
          <h2>Raccourcis clavier</h2>
          <span className="ma-muted">actifs quand « ShCuts » est jaune dans la ligne de commande</span>
        </header>
        <ul className="w-help__keys">
          {SHORTCUTS.map((s) => (
            <li key={s.syntax}>
              <span className="w-help__kbd">
                <kbd>{s.syntax}</kbd>
              </span>
              <span>{s.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-help__section">
        <header className="w-help__head">
          <h2>Gestes grandMA3</h2>
        </header>
        <dl className="w-help__gestures">
          {GESTURE_HELP.map((g) => (
            <div key={g.syntax} className="w-help__gesture">
              <dt>{g.syntax}</dt>
              <dd>{g.description}</dd>
            </div>
          ))}
          {GESTURES.map((g) => (
            <div key={g.title} className="w-help__gesture">
              <dt>{g.title}</dt>
              <dd>{g.text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const mod: WindowModule = {
  kind: "help",
  title: "Help",
  category: "More",
  defaultSize: { w: 12, h: 12 },
  minSize: { w: 6, h: 4 },
  Component: HelpWindow
};

export default mod;
