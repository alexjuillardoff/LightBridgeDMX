// Raccourcis clavier globaux (bouton « ShCuts » de la command line) :
//   F1-F8        → groupes de fonctions (1 Dimmer … 8 Shapers)
//   Échap        → Clear (cycle MA3 : sélection, puis valeurs actives) ; ferme d'abord un overlay
//   Ctrl+Entrée  → arme Store (met « Store » dans la command line)
//   caractère    → va dans la command line si aucun champ n'a le focus
import { useEffect } from "react";
import { FEATURE_GROUPS } from "../lib/attributes";
import { clear, setFeatureGroup } from "../state/programmer";
import { closeOverlay, workspaceStore } from "../state/workspace";
import { appendCommandText, focusCommandLine, isCommandLineInput, setCommandText } from "./CommandLine";
import { shortcutsStore } from "./shortcutsStore";
import { toast } from "./Toasts";

export { shortcutsStore, toggleShortcuts, useShortcutsEnabled } from "./shortcutsStore";

/** Vrai si l'élément reçoit la saisie clavier (champ texte, zone éditable…). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

const CLEAR_MESSAGES: Record<ReturnType<typeof clear>, string> = {
  selection: "Clear : sélection vidée",
  active: "Clear : valeurs du programmer oubliées",
  nothing: "Clear : rien à vider"
};

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Échap ferme toujours l'overlay ouvert, raccourcis actifs ou non.
      if (e.key === "Escape" && workspaceStore.get().overlay !== "none") {
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (!shortcutsStore.get().enabled) return;

      const editable = isEditableTarget(e.target);
      const inCommandLine = isCommandLineInput(e.target);

      // F1-F8 : groupes de fonctions, même pendant la saisie.
      const fn = /^F([1-8])$/.exec(e.key);
      if (fn && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const group = FEATURE_GROUPS[Number(fn[1]) - 1];
        if (group) {
          e.preventDefault();
          setFeatureGroup(group.id);
        }
        return;
      }

      // Ctrl+Entrée : arme Store dans la command line.
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setCommandText("Store ");
        focusCommandLine();
        toast("Store armé : complétez la commande (ex. Store Group 2)", "warn");
        return;
      }

      // Un autre champ a le focus : on ne lui vole pas ses touches.
      if (editable && !inCommandLine) return;

      if (e.key === "Escape") {
        // La command line vide son texte elle-même ; ici la ligne est déjà vide.
        e.preventDefault();
        const what = clear();
        toast(CLEAR_MESSAGES[what], what === "nothing" ? "info" : "ok");
        return;
      }

      // Saisie texte hors de tout champ → va dans la command line.
      if (!editable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        appendCommandText(e.key);
        focusCommandLine();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
