import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useMemo } from "react";
import { UniverseState } from "@lightbridgedmx/shared";

type UniverseStateValue = {
  universeState: UniverseState | null;
  setUniverseState: Dispatch<SetStateAction<UniverseState | null>>;
};

const UniverseStateCtx = createContext<UniverseStateValue | null>(null);

type ProviderProps = UniverseStateValue & { children: ReactNode };

export const UniverseStateProvider = ({ universeState, setUniverseState, children }: ProviderProps) => {
  const value = useMemo(() => ({ universeState, setUniverseState }), [universeState, setUniverseState]);
  return <UniverseStateCtx.Provider value={value}>{children}</UniverseStateCtx.Provider>;
};

export const useUniverseState = (): UniverseStateValue => {
  const ctx = useContext(UniverseStateCtx);
  if (!ctx) throw new Error("useUniverseState must be used within UniverseStateProvider");
  return ctx;
};
