// Ligne de commande MA3 : ◀ | M A | ⌨ Admin[Fixture]> saisie | icônes d'état | ▶
// - Entrée exécute (parseCommand → executeCommand), ↑/↓ parcourent l'historique
//   (50 entrées, clé lb3.history), Échap vide la ligne.
// - Le retour de commande remplace le prompt pendant 4 s (vert ok / rouge erreur).
// - Le texte vit dans un petit store pour que le clavier virtuel (Command Section)
//   et les raccourcis globaux puissent l'alimenter.
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";
import { createStore, useStore } from "../lib/store";
import { clearLocal, readLocal, writeLocal } from "../lib/local-store";
import { api } from "../lib/api";
import { runCommandLine } from "../lib/command/execute";
import { useUnread, useWsStatus } from "../state/app";
import { openOverlay, toggleBar } from "../state/workspace";
import {
  IconEnvelope,
  IconGlobe,
  IconKeyboard,
  IconMicMuted,
  IconNetwork,
  IconNoEntry,
  IconTriangleLeft,
  IconTriangleRight
} from "./icons";
import { toggleShortcuts, useShortcutsEnabled } from "./shortcutsStore";

// --- Store de la ligne ------------------------------------------------------------

export type CommandFeedback = { ok: boolean; message: string };
type CmdState = { text: string; feedback: CommandFeedback | null; history: string[] };

// Historique persisté sous lb3.history (lib/local-store), 50 entrées.
const HISTORY_KEY = "history";
const HISTORY_MAX = 50;
const FEEDBACK_MS = 4000;

function readHistory(): string[] {
  const parsed = readLocal<unknown>(HISTORY_KEY, []);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
}

function writeHistory(history: string[]): void {
  writeLocal(HISTORY_KEY, history);
}

export function clearCommandHistory(): void {
  commandLineStore.set((s) => ({ ...s, history: [] }));
  clearLocal(HISTORY_KEY);
}

export const commandLineStore = createStore<CmdState>({ text: "", feedback: null, history: readHistory() });

let inputEl: HTMLInputElement | null = null;
let feedbackTimer: number | null = null;

export function focusCommandLine(): void {
  inputEl?.focus();
}

export function isCommandLineInput(target: EventTarget | null): boolean {
  return inputEl !== null && target === inputEl;
}

export function setCommandText(text: string): void {
  commandLineStore.set((s) => ({ ...s, text }));
}

/** Ajoute du texte brut (saisie clavier globale). */
export function appendCommandText(chars: string): void {
  commandLineStore.set((s) => ({ ...s, text: s.text + chars }));
}

/** Ajoute un mot-clé (clavier virtuel) : séparé par une espace, sauf chiffres et « . » qui se collent. */
export function appendCommandToken(token: string): void {
  commandLineStore.set((s) => {
    const t = s.text;
    const glue = /^[0-9.]$/.test(token) && /[0-9.]$/.test(t);
    const sep = t.length === 0 || t.endsWith(" ") || glue ? "" : " ";
    return { ...s, text: t + sep + token };
  });
}

export function showCommandFeedback(feedback: CommandFeedback): void {
  commandLineStore.set((s) => ({ ...s, feedback }));
  if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    feedbackTimer = null;
    commandLineStore.set((s) => ({ ...s, feedback: null }));
  }, FEEDBACK_MS);
}

/** Analyse puis exécute une ligne ; renvoie le résultat et l'affiche 4 s. */
export async function runCommand(text: string): Promise<CommandFeedback> {
  const line = text.trim();
  if (line.length === 0) return { ok: true, message: "" };
  commandLineStore.set((s) => {
    const history = [...s.history.filter((h) => h !== line), line].slice(-HISTORY_MAX);
    writeHistory(history);
    return { ...s, text: "", history };
  });
  let result: CommandFeedback;
  try {
    result = await runCommandLine(line);
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  showCommandFeedback(result);
  return result;
}

/** Exécute le texte courant de la ligne (touche Please du clavier virtuel). */
export function submitCommandLine(): void {
  void runCommand(commandLineStore.get().text);
}

export function useCommandHistory(): string[] {
  return useStore(commandLineStore, (s) => s.history);
}

// Globe de la command line : healthcheck GET /api/health toutes les 15 s (et au montage).
const HEALTH_MS = 15000;
const healthStore = createStore<{ reachable: boolean | null }>({ reachable: null });

function useBackendReachable(): boolean | null {
  const reachable = useStore(healthStore, (s) => s.reachable);
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      let ok = false;
      try {
        await api.system.health();
        ok = true;
      } catch {
        ok = false;
      }
      if (alive) healthStore.set({ reachable: ok });
    };
    void probe();
    const timer = window.setInterval(() => void probe(), HEALTH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return reachable;
}

// --- Composant -------------------------------------------------------------------

export function CommandLine() {
  const text = useStore(commandLineStore, (s) => s.text);
  const feedback = useStore(commandLineStore, (s) => s.feedback);
  const unread = useUnread();
  const wsStatus = useWsStatus();
  const health = useBackendReachable();
  // Le WebSocket ouvert prouve aussi que le backend répond.
  const reachable = wsStatus === "open" || health === true;
  const shortcuts = useShortcutsEnabled();
  const [focused, setFocused] = useState(false);
  // Position dans l'historique pendant la navigation ↑/↓ (-1 = ligne en cours).
  const cursor = useRef(-1);
  const draft = useRef("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    inputEl = el;
    return () => {
      if (inputEl === el) inputEl = null;
    };
  }, []);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    cursor.current = -1;
    setCommandText(e.target.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const { history } = commandLineStore.get();
    if (e.key === "Enter") {
      e.preventDefault();
      cursor.current = -1;
      void runCommand(text);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (history.length === 0) return;
      e.preventDefault();
      if (cursor.current === -1) draft.current = text;
      // cursor compte depuis la fin : 0 = dernière commande.
      const next = e.key === "ArrowUp" ? Math.min(cursor.current + 1, history.length - 1) : cursor.current - 1;
      cursor.current = next;
      setCommandText(next < 0 ? draft.current : history[history.length - 1 - next] ?? "");
      return;
    }
    if (e.key === "Escape" && text.length > 0) {
      // Ligne non vide : on la vide seulement (le Clear global n'est pas déclenché).
      e.preventDefault();
      e.stopPropagation();
      cursor.current = -1;
      setCommandText("");
    }
  };

  // Clic sur la boîte (hors du champ) : focus sans perdre le placement du curseur dans l'input.
  const focus = (e?: MouseEvent) => {
    if (e && e.target === ref.current) return;
    e?.preventDefault();
    ref.current?.focus();
  };

  const netTitle =
    wsStatus === "open" ? "WebSocket connecté" : wsStatus === "connecting" ? "WebSocket : connexion…" : "WebSocket déconnecté";

  return (
    <div className="sh-cmd">
      <button
        type="button"
        className="sh-cmd__sq"
        onClick={() => toggleBar("control")}
        title="Afficher / masquer la control bar"
        aria-label="Afficher ou masquer la control bar"
      >
        <IconTriangleLeft />
      </button>
      <button
        type="button"
        className="sh-cmd__sq sh-cmd__ma"
        onClick={() => openOverlay("cmdHistory")}
        title="Historique des commandes"
        aria-label="Historique des commandes"
      >
        <span>M</span>
        <span>A</span>
      </button>

      <div className={`sh-cmd__box${focused ? " is-focused" : ""}`} onMouseDown={focus}>
        <button type="button" className="sh-cmd__kbd" onClick={() => focus()} tabIndex={-1} aria-label="Donner le focus à la ligne de commande">
          <IconKeyboard />
        </button>
        {feedback && feedback.message ? (
          <span className={`sh-cmd__feedback ${feedback.ok ? "is-ok" : "is-err"}`} role="status">
            {feedback.message}
          </span>
        ) : (
          <span className="sh-cmd__prompt" aria-hidden="true">
            Admin<span className="sh-cmd__kw">[Fixture]</span>&gt;
          </span>
        )}
        <input
          ref={ref}
          className="sh-cmd__input"
          type="text"
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Ligne de commande"
          enterKeyHint="go"
        />
      </div>

      <div className="sh-cmd__icons">
        <span className="sh-cmd__sq sh-cmd__status" title="Pas d'alerte">
          <IconNoEntry />
        </span>
        <span className="sh-cmd__sq sh-cmd__status" title="Micro coupé">
          <IconMicMuted />
        </span>
        <span className={`sh-cmd__sq sh-cmd__globe${reachable ? " is-on" : ""}`} title={reachable ? "Backend joignable" : "Backend injoignable"}>
          <IconGlobe />
        </span>
        <span className="sh-cmd__sq sh-cmd__spacer" aria-hidden="true" />
        <button
          type="button"
          className="sh-cmd__sq sh-cmd__mail"
          onClick={() => openOverlay("messages")}
          title="Message Center"
          aria-label={`Message Center, ${unread} non lus`}
        >
          <IconEnvelope />
          <small>{unread}</small>
        </button>
        <span className={`sh-cmd__sq sh-cmd__net is-${wsStatus}`} title={netTitle}>
          <IconNetwork />
        </span>
        <button
          type="button"
          className={`sh-cmd__sq sh-cmd__shcuts${shortcuts ? " is-on" : ""}`}
          onClick={toggleShortcuts}
          aria-pressed={shortcuts}
          title="Raccourcis clavier (F1-F8 groupes, Échap Clear, Ctrl+Entrée Store)"
        >
          <IconKeyboard />
          <small>ShCuts</small>
        </button>
      </div>

      <button
        type="button"
        className="sh-cmd__sq"
        onClick={() => toggleBar("view")}
        title="Afficher / masquer la view bar"
        aria-label="Afficher ou masquer la view bar"
      >
        <IconTriangleRight />
      </button>
    </div>
  );
}
