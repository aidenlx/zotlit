// The keys of a field's own popup — an editor's completion list or Signature
// Hint — on Obsidian's keymap, the way a native suggester takes them. While a
// popup stands in a focused field, a Scope of its own sits on top of the
// keymap: Tab and Enter take the list's option and Escape closes the popup,
// and the chooser page, the Filter popover or the dialog the field stands in
// never hears the key. Obsidian hears a key before the field does, from the
// main window and every popout, so a keymap of the field's own comes too late.
import type { Extension } from "@codemirror/state";
import { Scope } from "obsidian";
import type { App } from "obsidian";

import { fieldPopupKeyHost } from "@zotlit/workbench/language";
import type { FieldPopupKeyHost } from "@zotlit/workbench/language";

import { composing } from "./ime";

/**
 * Pushes the popup's Scope while a popup stands, parented to `app.scope` as
 * Obsidian's own suggesters are, so every hotkey it leaves alone still runs.
 */
export function popupScope(
  app: Pick<App, "scope" | "keymap">,
): FieldPopupKeyHost {
  return (keys) => {
    const scope = new Scope(app.scope);
    let pushed = true;
    const release = () => {
      if (pushed) app.keymap.popScope(scope);
      pushed = false;
    };
    // A key the popup did not act on, typed into a composition or arriving
    // in the list's first moments, reaches the field untouched.
    const take = (act: () => boolean) => (event: KeyboardEvent) =>
      composing(event) || !act() ? undefined : false;
    scope.register([], "Tab", take(keys.accept));
    scope.register([], "Enter", take(keys.accept));
    scope.register([], "Escape", take(keys.close));
    // Shift-Tab moves focus out of the field. The Scope comes off first, so
    // the surface below has the keymap back before focus moves: a dialog
    // keeps focus inside it only while its own Scope is on top.
    scope.register(["Shift"], "Tab", () => {
      release();
      return undefined;
    });
    // Onto the stack of the window that has focus, which is the field's.
    app.keymap.pushScope(scope);
    return release;
  };
}

/** The editor extension that puts a field's popup keys on `app`'s keymap. */
export function obsidianPopupKeys(app: App): Extension {
  return fieldPopupKeyHost.of(popupScope(app));
}
