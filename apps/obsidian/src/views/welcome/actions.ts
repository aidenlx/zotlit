// UI action bindings for the Welcome View banner, exposed to the presentational tree via context.
import { createContext, useContext } from "react";

import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";

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
  /** Open the Release Note of the running version, acknowledging its update. */
  openReleaseNote: () => void;
  retryTemplateCleanup: () => Promise<void>;
  /** Resolves with the outcome so the banner can keep a refusal in view. */
  convertLiteratureNoteTemplates: () => Promise<LiteratureNoteTemplateMigrationResult>;
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
