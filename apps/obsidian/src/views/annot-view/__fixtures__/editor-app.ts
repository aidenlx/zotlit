// The comment editor's App, for tests that mount the editor.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import { Scope } from "obsidian";
import type { App } from "obsidian";

/**
 * The app the comment editor takes its keys through: a keymap whose pushed
 * scopes a test can read and press, and no editor commands to hold.
 */
export function editorApp(): App & { scopes: Scope[] } {
  const scopes: Scope[] = [];
  return {
    scope: new Scope(),
    scopes,
    keymap: {
      pushScope: (scope: Scope) => scopes.push(scope),
      popScope: (scope: Scope) => {
        const index = scopes.indexOf(scope);
        if (index !== -1) scopes.splice(index, 1);
      },
    },
    commands: { editorCommands: {} },
    hotkeyManager: {
      getHotkeys: () => undefined,
      getDefaultHotkeys: () => undefined,
    },
  } as unknown as App & { scopes: Scope[] };
}

/** Mod+Enter, through the scope the focused comment editor pushed last. */
export function pressSubmit(app: { scopes: Scope[] }): void {
  // The mock Scope records what it was given, which the real type hides.
  const scope = app.scopes.at(-1) as unknown as
    | {
        handlers: {
          modifiers: string[] | null;
          key: string | null;
          func: (event: KeyboardEvent) => unknown;
        }[];
      }
    | undefined;
  scope?.handlers
    .find(
      ({ modifiers, key }) => modifiers?.join() === "Mod" && key === "Enter",
    )
    ?.func(new KeyboardEvent("keydown"));
}
