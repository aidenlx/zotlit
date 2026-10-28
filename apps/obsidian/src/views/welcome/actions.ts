// UI action bindings for the Welcome View banner, exposed to the presentational tree via context.
import { createContext, useContext } from "react";

import type { SetupActions } from "./setup-actions";

/** What the view that hosts the banner does for it. */
export interface WelcomeBannerHost {
  /** Put the cursor in the host's own search box. */
  searchLibrary: () => void;
}

export interface WelcomeActions extends SetupActions, WelcomeBannerHost {
  openExternal: (url: string) => void;
  /**
   * Put the banner away; this acknowledges the Migration Prompt of the
   * upgraded state and the update of the running version.
   */
  dismiss: () => void;
  /** Open or fold the checklist under the "Setup done" line, until a dismissal. */
  showSteps: (shown: boolean) => void;
  /** Open the Release Note of the running version, acknowledging its update. */
  openReleaseNote: () => void;
  /** Retry the cleanup of the converted templates; the banner reads the run. */
  retryTemplateCleanup: () => void;
  /** Convert the templates; the banner reads the run, to keep a refusal in view. */
  convertLiteratureNoteTemplates: () => void;
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
