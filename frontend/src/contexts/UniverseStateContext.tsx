// Contexte React qui partage l'etat de l'univers DMX (les 512 canaux) dans toute l'UI.
// Evite de passer universeState/setUniverseState en props a travers tous les composants.
// L'etat est mis a jour en haut de l'arbre (depuis le flux WebSocket) puis lu ici par les enfants.
//
// Deux contextes cohabitent volontairement :
//  - UniverseStateCtx : la valeur qui change a chaque tick (30 Hz). Y souscrire
//    fait re-rendre le composant 30 fois par seconde — c'est ce qu'on veut pour
//    un fader ou une cellule de sheet, et seulement pour ceux-la.
//  - UniverseRefCtx : une reference stable vers le dernier tableau de valeurs.
//    Elle ne declenche JAMAIS de rendu. C'est ce qu'utilise le code qui a besoin
//    de lire l'univers au moment d'une action (STORE d'une scene, capture d'un
//    preset) sans vouloir se reveiller a chaque trame.
import {
  Dispatch,
  MutableRefObject,
  ReactNode,
  SetStateAction,
  createContext,
  useContext,
  useMemo,
  useRef
} from "react";
import { UniverseState } from "@lightbridgedmx/shared";

// Valeur exposee par le contexte : l'instantane (snapshot) de l'univers et son setter.
// null tant qu'aucune trame n'a encore ete recue du backend.
type UniverseStateValue = {
  universeState: UniverseState | null;
  setUniverseState: Dispatch<SetStateAction<UniverseState | null>>;
};

const UniverseStateCtx = createContext<UniverseStateValue | null>(null);
const UniverseRefCtx = createContext<MutableRefObject<number[]> | null>(null);

type ProviderProps = UniverseStateValue & { children: ReactNode };

// Fournit l'etat de l'univers a tous les composants enfants.
// useMemo : on ne recree l'objet de contexte que si l'etat ou le setter change,
// pour eviter des re-rendus inutiles des consommateurs.
export const UniverseStateProvider = ({ universeState, setUniverseState, children }: ProviderProps) => {
  const value = useMemo(() => ({ universeState, setUniverseState }), [universeState, setUniverseState]);

  // Miroir des valeurs courantes dans une ref. On l'ecrit pendant le rendu :
  // le provider re-rend a chaque tick de toute facon, et la ref est ainsi a jour
  // avant que le moindre enfant ne puisse la lire.
  const valuesRef = useRef<number[]>([]);
  valuesRef.current = universeState?.values ?? valuesRef.current;

  return (
    <UniverseStateCtx.Provider value={value}>
      <UniverseRefCtx.Provider value={valuesRef}>{children}</UniverseRefCtx.Provider>
    </UniverseStateCtx.Provider>
  );
};

// Hook d'acces a l'etat de l'univers depuis n'importe quel composant.
// Leve une erreur explicite si on l'utilise hors du Provider (oubli de wrapping).
export const useUniverseState = (): UniverseStateValue => {
  const ctx = useContext(UniverseStateCtx);
  if (!ctx) throw new Error("useUniverseState must be used within UniverseStateProvider");
  return ctx;
};

/**
 * Acces en lecture seule aux valeurs courantes, SANS abonnement aux ticks.
 * A utiliser dans un gestionnaire d'evenement (`ref.current[canal - 1]`), jamais
 * pendant le rendu : la ref changeant sans prevenir React, l'affichage ne serait
 * pas rafraichi.
 */
export const useUniverseValuesRef = (): MutableRefObject<number[]> => {
  const ref = useContext(UniverseRefCtx);
  if (!ref) throw new Error("useUniverseValuesRef must be used within UniverseStateProvider");
  return ref;
};
