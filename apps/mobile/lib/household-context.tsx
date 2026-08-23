import { createContext, useContext, type ReactNode } from "react";

import { useAuth } from "./auth-context";
import { useHousehold, type HouseholdState } from "./use-household";

/**
 * One household read for the whole signed-in stack.
 *
 * Every tab needs the same three answers — my person id, my children, our
 * teams — and the thread screen needs the person id to send as. Fetching that
 * once per tab would mean five `current_person_id()` round trips on a cold
 * start, so it is read at the top of the signed-in stack and shared.
 */

const HouseholdContext = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const state = useHousehold(session?.user.id);
  return (
    <HouseholdContext.Provider value={state}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHouseholdContext(): HouseholdState {
  const value = useContext(HouseholdContext);
  if (!value) {
    throw new Error("useHouseholdContext must be used inside <HouseholdProvider>");
  }
  return value;
}
