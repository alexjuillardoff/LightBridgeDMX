// Selection courante de projecteurs, au sens "programmer" d'un pupitre :
// les projecteurs selectionnes (surlignes en jaune dans la fixture sheet) sont
// la cible des encodeurs et des commandes tapees dans la ligne de commande.
//
// La selection est volontairement stockee en dehors des pages : on la garde en
// changeant d'onglet, exactement comme un pupitre garde son programmer.
import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

type SelectionValue = {
  // Ids des projecteurs selectionnes, dans l'ordre de selection.
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  // Bascule un projecteur (clic simple dans la fixture sheet).
  toggle: (id: string) => void;
  // Remplace toute la selection (commande "Fixture 1 + 3").
  select: (ids: string[]) => void;
  // Vide la selection (touche Clear du pupitre).
  clear: () => void;
};

const SelectionCtx = createContext<SelectionValue | null>(null);

export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  // On dedoublonne : une commande peut citer deux fois le meme projecteur.
  const select = useCallback((ids: string[]) => {
    setSelectedIds(Array.from(new Set(ids)));
  }, []);

  const clear = useCallback(() => setSelectedIds([]), []);

  const value = useMemo<SelectionValue>(
    () => ({ selectedIds, isSelected, toggle, select, clear }),
    [selectedIds, isSelected, toggle, select, clear]
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
};

// Hook d'acces a la selection. Erreur explicite si on oublie le Provider.
export const useSelection = (): SelectionValue => {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
};
