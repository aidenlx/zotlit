// A layer's keys on Obsidian's keymap while focus stands in the layer. The
// keymap hears a key before any element does, and consults only the Scope
// on top of the focused window's stack, so a layer whose keys the surface
// around it also claims holds a Scope of its own there.
// @see apps/obsidian/policies/keyboard-scope.md
import type { App, Scope } from "obsidian";

import { disposable } from "./disposables";

/** A Scope held on the keymap while focus stands inside an element. */
export interface FocusScope extends Disposable {
  /** Take the Scope off the keymap now; focus coming in again pushes it. */
  release(): void;
}

/**
 * Put `scope` on `keymap` while focus stands inside `el`, onto the stack of
 * the window focus came in, which is `el`'s. It comes off as focus leaves
 * `el`, as `el` moves to another window, and on dispose; focus already in
 * `el` pushes it at once. A surface around `el` that holds a Scope of its
 * own pushes it as `focusin` captures, so `el`'s stays on top.
 *
 * @param options.when whether focus coming in pushes the Scope, for a layer
 *   that only stands some of the time.
 */
export function holdScopeWhileFocused(
  el: HTMLElement,
  scope: Scope,
  {
    keymap,
    when = () => true,
  }: {
    keymap: Pick<App["keymap"], "pushScope" | "popScope">;
    when?: () => boolean;
  },
): FocusScope {
  let pushed = false;
  const release = () => {
    if (pushed) keymap.popScope(scope);
    pushed = false;
  };
  // Each focus coming in puts the Scope back on top: a surface around `el`
  // that pushes its own on the same focus does so as the event comes down,
  // before this one, so the layer inside stays above it.
  const hold = () => {
    if (!when()) return;
    if (pushed) keymap.popScope(scope);
    keymap.pushScope(scope);
    pushed = true;
  };
  const leave = (event: FocusEvent) => {
    if (!el.contains(event.relatedTarget as Node | null)) release();
  };
  el.addEventListener("focusin", hold);
  el.addEventListener("focusout", leave);
  // The Scope stands on one window's stack; focus coming back in the new
  // window pushes it there.
  const unwatch = el.onWindowMigrated(release);
  if (el.contains(el.doc.activeElement)) hold();
  return {
    release,
    ...disposable(() => {
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", leave);
      unwatch();
      release();
    }),
  };
}
