// Selection courante de projecteurs, au sens "programmer" d'un pupitre :
// les projecteurs selectionnes (surlignes en jaune dans la fixture sheet) sont
// la cible des encodeurs, des commandes tapees et de STORE.
//
// La selection est volontairement stockee en dehors des pages : on la garde en
// changeant de vue, exactement comme un pupitre garde son programmer.
//
// C'est aussi ici qu'est applique le garde-fou : un projecteur verrouille
// (lib/fixtureGuard) ne peut PAS entrer dans la selection. Le blocage vit donc
// dans le programmer lui-meme, pas dans chaque bouton — la fixture sheet, la
// ligne de commande, ALL et les groupes en heritent sans avoir a y penser.
import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAppData } from "./AppDataContext";
import { isLockedFixture } from "../lib/fixtureGuard";

type SelectionValue = {
  // Ids des projecteurs selectionnes, dans l'ordre de selection.
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  // true si ce projecteur est verrouille (cadenas dans la sheet, clic inopérant).
  isLocked: (id: string) => boolean;
  // Bascule un projecteur (clic simple dans la fixture sheet).
  toggle: (id: string) => void;
  // Remplace toute la selection (commande "Fixture 1 + 3", rappel de groupe).
  select: (ids: string[]) => void;
  // Ajoute a la selection sans rien retirer (commande "+").
  add: (ids: string[]) => void;
  // Vide la selection (touche Clear du pupitre).
  clear: () => void;
};

const SelectionCtx = createContext<SelectionValue | null>(null);

export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const { fixtures } = useAppData();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Ids refuses au programmer. Recalcule quand le patch change : un projecteur
  // renomme "PAR chambre" devient verrouille sans rechargement de page.
  const lockedIds = useMemo(
    () => new Set(fixtures.filter(isLockedFixture).map((f) => f.id)),
    [fixtures]
  );

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);
  const isLocked = useCallback((id: string) => lockedIds.has(id), [lockedIds]);

  const toggle = useCallback(
    (id: string) => {
      if (lockedIds.has(id)) return;
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    },
    [lockedIds]
  );

  // On dedoublonne (une commande peut citer deux fois le meme projecteur) et on
  // retire les verrouilles.
  const select = useCallback(
    (ids: string[]) => {
      setSelectedIds(Array.from(new Set(ids.filter((id) => !lockedIds.has(id)))));
    },
    [lockedIds]
  );

  const add = useCallback(
    (ids: string[]) => {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...ids.filter((id) => !lockedIds.has(id))]))
      );
    },
    [lockedIds]
  );

  const clear = useCallback(() => setSelectedIds([]), []);

  const value = useMemo<SelectionValue>(
    () => ({ selectedIds, isSelected, isLocked, toggle, select, add, clear }),
    [selectedIds, isSelected, isLocked, toggle, select, add, clear]
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
};

// Hook d'acces a la selection. Erreur explicite si on oublie le Provider.
export const useSelection = (): SelectionValue => {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
};
