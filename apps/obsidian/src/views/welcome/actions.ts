// UI action bindings for the Welcome View, exposed to the presentational tree via context.
import { createContext, useContext } from "react";

import type { SetupActions } from "./setup-actions";

export interface WelcomeActions extends SetupActions {
  openExternal: (url: string) => void;
}

export const WelcomeActionsContext = createContext<WelcomeActions | null>(null);

export function useWelcomeActions(): WelcomeActions {
  const actions = useContext(WelcomeActionsContext);
  if (!actions) {
    throw new Error(
      "useWelcomeActions must be used within WelcomeActionsContext",
    );
  }
  return actions;
}
