// Etat partage de la ligne de commande du pupitre.
//
// La saisie n'appartient pas a la barre du bas : le pavé de touches du rail
// droit ("Fixture", "Thru", "At", "7 8 9", "Please"...) ecrit dans la meme
// ligne, exactement comme sur un grandMA ou le clavier physique et la ligne de
// commande a l'ecran sont une seule et meme chose.
//
// Ce contexte porte donc : le texte en cours, l'historique, le dernier retour
// affiche, et l'execution des commandes analysees par lib/commandLine.
import { ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Fixture } from "@lightbridgedmx/shared";
import { useAppData } from "./AppDataContext";
import { useSelection } from "./SelectionContext";
import { COMMAND_HELP, parseCommand } from "../lib/commandLine";
import { applyAttr, toPct } from "../lib/programmer";
import { setActiveTabHash } from "../shell/navigate";
import { isTabId } from "../shell/tabs";

// Niveau du retour de commande : colore la ligne de feedback.
export type FeedbackLevel = "info" | "ok" | "warn" | "error";
export type Feedback = { level: FeedbackLevel; text: string; at: string };

type CommandValue = {
  input: string;
  setInput: (value: string) => void;
  // Ajoute un mot-cle ou un chiffre a la ligne (touches du pavé).
  append: (token: string) => void;
  // Efface le dernier caractere (touche retour arriere du pavé).
  backspace: () => void;
  // Valide la ligne en cours (touche Please).
  submit: () => void;
  // Execute une commande sans passer par la saisie (touches rapides).
  runLine: (line: string) => void;
  // Rappel de l'historique : direction -1 (plus ancien) ou +1 (plus recent).
  recall: (direction: -1 | 1) => void;
  feedback: Feedback | null;
};

const CommandCtx = createContext<CommandValue | null>(null);

export const CommandProvider = ({ children }: { children: ReactNode }) => {
  const { fixtures, handleUpdateChannel, handleBlackout } = useAppData();
  const { selectedIds, select, clear } = useSelection();

  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Historique des commandes tapees (le plus recent en tete).
  const history = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const selectedFixtures = useMemo(
    () => fixtures.filter((f) => selectedIds.includes(f.id)),
    [fixtures, selectedIds]
  );

  // Execute une ligne et renvoie le retour a afficher (sans horodatage).
  const execute = useCallback(
    (line: string): Omit<Feedback, "at"> => {
      const command = parseCommand(line);

      switch (command.kind) {
        case "error":
          return { level: "error", text: command.message };

        case "help":
          return { level: "info", text: COMMAND_HELP.join("   ·   ") };

        case "clear":
          clear();
          return { level: "ok", text: "Sélection vidée" };

        case "blackout":
          void handleBlackout();
          return { level: "warn", text: "Blackout — 512 canaux à zéro" };

        case "selectAll": {
          if (!fixtures.length) return { level: "warn", text: "Aucun projecteur à sélectionner" };
          select(fixtures.map((f) => f.id));
          return { level: "ok", text: `${fixtures.length} projecteurs sélectionnés` };
        }

        case "view":
          if (!isTabId(command.view)) return { level: "error", text: `Vue inconnue : ${command.view}` };
          setActiveTabHash(command.view);
          return { level: "ok", text: `Vue ${command.view}` };

        case "channel": {
          command.channels.forEach((ch) => handleUpdateChannel(ch, command.value));
          // Libellé compact : "12" pour un canal seul, "5 → 8" pour une plage
          // contiguë, sinon la liste telle qu'elle a été saisie.
          const { channels } = command;
          const contiguous = channels.every((ch, i) => i === 0 || ch === channels[i - 1] + 1);
          const label =
            channels.length === 1
              ? `${channels[0]}`
              : contiguous
              ? `${channels[0]} → ${channels[channels.length - 1]}`
              : channels.join(", ");
          return {
            level: "ok",
            text: `Canal ${label} à ${toPct(command.value)} % (${command.value} DMX) · ${channels.length} canaux`
          };
        }

        case "select": {
          // Les numeros tapes sont ceux affiches dans la fixture sheet.
          const picked = command.numbers
            .map((n) => fixtures[n - 1])
            .filter((f): f is Fixture => Boolean(f));
          if (!picked.length) {
            return { level: "error", text: `Aucun projecteur pour ${command.numbers.join(", ")}` };
          }
          select(picked.map((f) => f.id));

          if (!command.then) {
            return { level: "ok", text: `Sélection : ${picked.map((f) => f.name).join(", ")}` };
          }
          const touched = applyAttr(picked, command.then.attr, command.then.value, handleUpdateChannel);
          if (!touched) {
            return { level: "warn", text: `Aucun canal ${command.then.attr} sur cette sélection` };
          }
          return {
            level: "ok",
            text: `${picked.length} projecteur(s) · ${command.then.attr} ${toPct(command.then.value)} %`
          };
        }

        case "attr": {
          if (!selectedFixtures.length) {
            return { level: "warn", text: "Sélection vide — tapez FIXTURE 1 d'abord" };
          }
          const touched = applyAttr(selectedFixtures, command.attr, command.value, handleUpdateChannel);
          if (!touched) {
            return { level: "warn", text: `Aucun canal ${command.attr} sur cette sélection` };
          }
          return {
            level: "ok",
            text: `${selectedFixtures.length} projecteur(s) · ${command.attr} ${toPct(command.value)} % (${touched} canaux)`
          };
        }

        default:
          return { level: "error", text: "Commande non gérée" };
      }
    },
    [clear, fixtures, handleBlackout, handleUpdateChannel, select, selectedFixtures]
  );

  // Horodate et affiche un retour de commande.
  const report = useCallback((result: Omit<Feedback, "at">) => {
    setFeedback({ ...result, at: new Date().toISOString() });
  }, []);

  const runLine = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      report(execute(trimmed));
    },
    [execute, report]
  );

  const submit = useCallback(() => {
    const line = input.trim();
    if (!line) return;
    report(execute(line));
    history.current = [line, ...history.current].slice(0, 50);
    historyPos.current = -1;
    setInput("");
  }, [execute, input, report]);

  // Concatene un jeton a la ligne : on insere une espace sauf pour les chiffres
  // qui suivent un chiffre (on tape "12", pas "1 2").
  const append = useCallback((token: string) => {
    setInput((prev) => {
      if (!prev) return token;
      const glue = /\d$/.test(prev) && /^[\d.]/.test(token) ? "" : " ";
      return `${prev}${glue}${token}`;
    });
  }, []);

  const backspace = useCallback(() => {
    setInput((prev) => prev.replace(/\s*\S$/, ""));
  }, []);

  // Rappel de l'historique avec les fleches haut/bas.
  const recall = useCallback((direction: -1 | 1) => {
    if (!history.current.length) return;
    const next =
      direction === -1
        ? Math.min(historyPos.current + 1, history.current.length - 1)
        : Math.max(historyPos.current - 1, -1);
    historyPos.current = next;
    setInput(next === -1 ? "" : history.current[next]);
  }, []);

  const value = useMemo<CommandValue>(
    () => ({ input, setInput, append, backspace, submit, runLine, recall, feedback }),
    [append, backspace, feedback, input, recall, runLine, submit]
  );

  return <CommandCtx.Provider value={value}>{children}</CommandCtx.Provider>;
};

export const useCommand = (): CommandValue => {
  const ctx = useContext(CommandCtx);
  if (!ctx) throw new Error("useCommand must be used within CommandProvider");
  return ctx;
};
