// Contexte React qui partage l'etat de l'univers DMX (les 512 canaux) dans toute l'UI.
// Evite de passer universeState/setUniverseState en props a travers tous les composants.
// L'etat est mis a jour en haut de l'arbre (depuis le flux WebSocket) puis lu ici par les enfants.
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useMemo } from "react";
import { UniverseState } from "@lightbridgedmx/shared";

// Valeur exposee par le contexte : l'instantane (snapshot) de l'univers et son setter.
// null tant qu'aucune trame n'a encore ete recue du backend.
type UniverseStateValue = {
  universeState: UniverseState | null;
  setUniverseState: Dispatch<SetStateAction<UniverseState | null>>;
};

const UniverseStateCtx = createContext<UniverseStateValue | null>(null);

type ProviderProps = UniverseStateValue & { children: ReactNode };

// Fournit l'etat de l'univers a tous les composants enfants.
// useMemo : on ne recree l'objet de contexte que si l'etat ou le setter change,
// pour eviter des re-rendus inutiles des consommateurs.
export const UniverseStateProvider = ({ universeState, setUniverseState, children }: ProviderProps) => {
  const value = useMemo(() => ({ universeState, setUniverseState }), [universeState, setUniverseState]);
  return <UniverseStateCtx.Provider value={value}>{children}</UniverseStateCtx.Provider>;
};

// Hook d'acces a l'etat de l'univers depuis n'importe quel composant.
// Leve une erreur explicite si on l'utilise hors du Provider (oubli de wrapping).
export const useUniverseState = (): UniverseStateValue => {
  const ctx = useContext(UniverseStateCtx);
  if (!ctx) throw new Error("useUniverseState must be used within UniverseStateProvider");
  return ctx;
};
