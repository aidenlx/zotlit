import type { App } from "obsidian";
import { createContext, useContext } from "react";

/**
 * The running {@link App}, for a component general enough that no caller is the
 * natural place to hand it one. The Chooser needs it and nothing else does yet:
 * its keyboard scope is parented to `app.scope` and pushed onto `app.keymap`,
 * and neither is reachable from the element the component draws.
 *
 * A view supplies it where it mounts its tree, beside its store and its
 * actions.
 */
export const AppContext = createContext<App | null>(null);

/**
 * The running App. Throws outside an {@link AppContext} rather than going
 * quietly inert, because what it feeds — the keyboard — fails silently.
 */
export function useObsidianApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("Rendered outside an Obsidian AppContext");
  return app;
}
