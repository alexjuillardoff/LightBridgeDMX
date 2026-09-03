// Etat partage de la ligne de commande du pupitre.
//
// La saisie n'appartient pas a la barre du bas : le pave de touches du rail
// droit ("Fixture", "Thru", "At", "Store", "Go", "7 8 9", "Please"...) ecrit dans
// la meme ligne, exactement comme sur un grandMA ou le clavier physique et la
// ligne de commande a l'ecran sont une seule et meme chose.
//
// Ce contexte porte donc : le texte en cours, l'historique, le dernier retour
// affiche, et l'execution des commandes analysees par lib/commandLine. Les
// commandes qui touchent aux pools (STORE / GO / OFF / GROUP / PRESET) sont
// deleguees a ConsoleContext, qui detient la mecanique.
import { ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Fixture } from "@lightbridgedmx/shared";
import { useAppData } from "./AppDataContext";
import { useConsole } from "./ConsoleContext";
import { useSelection } from "./SelectionContext";
import { COMMAND_HELP, parseCommand } from "../lib/commandLine";
import { ActionResult, FeedbackLevel, fail, info, ok, warn } from "../lib/feedback";
import { isLockedFixture } from "../lib/fixtureGuard";
import { applyAttr, toPct } from "../lib/programmer";
import { setActiveTabHash } from "../shell/navigate";
import { routeLabel } from "../shell/tabs";

export type { FeedbackLevel };
export type Feedback = ActionResult & { at: string };

type CommandValue = {
  input: string;
  setInput: (value: string) => void;
  // Ajoute un mot-cle ou un chiffre a la ligne (touches du pave).
  append: (token: string) => void;
  // Efface le dernier caractere (touche retour arriere du pave).
  backspace: () => void;
  // Valide la ligne en cours (touche Please).
  submit: () => void;
  // Execute une commande sans passer par la saisie (touches rapides, tuiles).
  runLine: (line: string) => void;
  // Affiche un retour venu d'ailleurs (clic sur une tuile d'executor, un groupe...).
  report: (result: ActionResult) => void;
  // Rappel de l'historique : direction -1 (plus ancien) ou +1 (plus recent).
  recall: (direction: -1 | 1) => void;
  feedback: Feedback | null;
};

const CommandCtx = createContext<CommandValue | null>(null);

export const CommandProvider = ({ children }: { children: ReactNode }) => {
  const { fixtures, handleUpdateChannel, handleBlackout } = useAppData();
  const { selectedIds, select, clear } = useSelection();
  const { storeExecutor, goExecutor, offExecutor, storeGroup, recallGroup, storePreset, applyPreset } =
    useConsole();

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
  // Certaines commandes passent par le reseau : le retour peut donc etre differe.
  const execute = useCallback(
    (line: string): ActionResult | Promise<ActionResult> => {
      const command = parseCommand(line);

      switch (command.kind) {
        case "error":
          return fail(command.message);

        case "help":
          return info(COMMAND_HELP.join("   ·   "));

        case "clear":
          clear();
          return ok("Sélection vidée");

        case "blackout":
          void handleBlackout();
          return warn("Blackout — 512 canaux à zéro");

        case "selectAll": {
          // ALL ne prend jamais les projecteurs verrouilles : le garde-fou doit
          // resister au geste le plus large du pupitre.
          const selectable = fixtures.filter((f) => !isLockedFixture(f));
          if (!selectable.length) return warn("Aucun projecteur à sélectionner");
          select(selectable.map((f) => f.id));
          const skipped = fixtures.length - selectable.length;
          return ok(
            `${selectable.length} projecteurs sélectionnés${skipped ? ` · ${skipped} verrouillé(s) ignoré(s)` : ""}`
          );
        }

        case "view": {
          // setActiveTabHash resout le mot tape ("patch", "reseau",
          // "patch/lampes") et renvoie la destination reellement atteinte.
          const route = setActiveTabHash(command.view);
          if (!route) return fail(`Vue inconnue : ${command.view}`);
          return ok(`Vue ${routeLabel(route)}`);
        }

        case "store":
          // Les numeros tapes sont ceux affiches sur les tuiles (1-indexes).
          if (command.target === "group") return storeGroup(command.number, command.name);
          if (command.target === "preset") return storePreset(command.number - 1, command.name);
          return storeExecutor(command.number - 1, command.name);

        case "go":
          return goExecutor(command.number - 1);

        case "off":
          return offExecutor(command.number - 1);

        case "group":
          return recallGroup(command.number);

        case "preset":
          return applyPreset(command.number - 1);

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
          return ok(
            `Canal ${label} à ${toPct(command.value)} % (${command.value} DMX) · ${channels.length} canaux`
          );
        }

        case "select": {
          // Les numeros tapes sont ceux affiches dans la fixture sheet.
          const picked = command.numbers
            .map((n) => fixtures[n - 1])
            .filter((f): f is Fixture => Boolean(f));
          if (!picked.length) {
            return fail(`Aucun projecteur pour ${command.numbers.join(", ")}`);
          }
          // Un projecteur verrouille cite explicitement merite un refus explicite,
          // sinon la commande semblerait avoir marche a moitie sans rien dire.
          const usable = picked.filter((f) => !isLockedFixture(f));
          if (!usable.length) {
            return warn(`Projecteur(s) verrouillé(s) : ${picked.map((f) => f.name).join(", ")}`);
          }
          select(usable.map((f) => f.id));

          const lockedNote =
            usable.length < picked.length ? ` · ${picked.length - usable.length} verrouillé(s) ignoré(s)` : "";

          if (!command.then) {
            return ok(`Sélection : ${usable.map((f) => f.name).join(", ")}${lockedNote}`);
          }
          const touched = applyAttr(usable, command.then.attr, command.then.value, handleUpdateChannel);
          if (!touched) {
            return warn(`Aucun canal ${command.then.attr} sur cette sélection`);
          }
          return ok(
            `${usable.length} projecteur(s) · ${command.then.attr} ${toPct(command.then.value)} %${lockedNote}`
          );
        }

        case "attr": {
          const usable = selectedFixtures.filter((f) => !isLockedFixture(f));
          if (!usable.length) {
            return warn("Sélection vide — tapez FIXTURE 1 d'abord");
          }
          const touched = applyAttr(usable, command.attr, command.value, handleUpdateChannel);
          if (!touched) {
            return warn(`Aucun canal ${command.attr} sur cette sélection`);
          }
          return ok(
            `${usable.length} projecteur(s) · ${command.attr} ${toPct(command.value)} % (${touched} canaux)`
          );
        }

        default:
          return fail("Commande non gérée");
      }
    },
    [
      applyPreset,
      clear,
      fixtures,
      goExecutor,
      handleBlackout,
      handleUpdateChannel,
      offExecutor,
      recallGroup,
      select,
      selectedFixtures,
      storeExecutor,
      storeGroup,
      storePreset
    ]
  );

  // Horodate et affiche un retour de commande.
  const report = useCallback((result: ActionResult) => {
    setFeedback({ ...result, at: new Date().toISOString() });
  }, []);

  // Affiche le retour d'une commande, qu'il soit immediat ou differe (reseau).
  const reportMaybeAsync = useCallback(
    (result: ActionResult | Promise<ActionResult>) => {
      if (result instanceof Promise) {
        void result.then(report).catch((err: Error) => report(fail(err.message)));
        return;
      }
      report(result);
    },
    [report]
  );

  const runLine = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      reportMaybeAsync(execute(trimmed));
    },
    [execute, reportMaybeAsync]
  );

  const submit = useCallback(() => {
    const line = input.trim();
    if (!line) return;
    reportMaybeAsync(execute(line));
    history.current = [line, ...history.current].slice(0, 50);
    historyPos.current = -1;
    setInput("");
  }, [execute, input, reportMaybeAsync]);

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
    () => ({ input, setInput, append, backspace, submit, runLine, report, recall, feedback }),
    [append, backspace, feedback, input, recall, report, runLine, submit]
  );

  return <CommandCtx.Provider value={value}>{children}</CommandCtx.Provider>;
};

export const useCommand = (): CommandValue => {
  const ctx = useContext(CommandCtx);
  if (!ctx) throw new Error("useCommand must be used within CommandProvider");
  return ctx;
};
