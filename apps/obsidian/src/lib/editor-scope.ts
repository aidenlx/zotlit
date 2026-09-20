import type { Scope } from "obsidian";

import {
  disposable,
  registerDomEvent,
  registerKeymap,
} from "@/lib/disposables";

/** Bind Mod+Enter to one focused editor through its owning Obsidian Scope. */
export function bindEditorSubmitScope(
  editor: HTMLTextAreaElement,
  scope: Scope,
  submit: () => void,
): Disposable {
  let keymap: Disposable | null = null;
  const deactivate = (): void => {
    keymap?.[Symbol.dispose]();
    keymap = null;
  };
  const activate = (): void => {
    if (keymap || editor.ownerDocument.activeElement !== editor) return;
    keymap = registerKeymap(scope, ["Mod"], "Enter", (event) => {
      if (editor.ownerDocument.activeElement !== editor) return;
      event.preventDefault();
      submit();
      return false;
    });
  };

  const focus = registerDomEvent(editor, "focus", activate);
  const blur = registerDomEvent(editor, "blur", deactivate);
  const stopMigration = editor.onWindowMigrated(() => {
    deactivate();
    activate();
  });
  activate();

  return disposable(() => {
    stopMigration();
    blur[Symbol.dispose]();
    focus[Symbol.dispose]();
    deactivate();
  });
}
