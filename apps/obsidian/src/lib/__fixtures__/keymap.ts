// Obsidian's keymap, for tests of a layer that holds a Scope of its own: an
// app whose keymap records the Scopes pushed on it, and one keystroke handed
// to a Scope as Obsidian hands it.
import { Scope } from "obsidian";
import type { App, Modifier } from "obsidian";

/** An app whose keymap records its stack, the last Scope pushed on top. */
export function keymapApp(): Pick<App, "scope" | "keymap"> & {
  scopes: Scope[];
} {
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
    } as App["keymap"],
  };
}

const MODIFIER_HELD: Readonly<
  Record<string, (event: KeyboardEvent) => boolean>
> = {
  Ctrl: (event) => event.ctrlKey,
  Meta: (event) => event.metaKey,
  Alt: (event) => event.altKey,
  Shift: (event) => event.shiftKey,
};

/**
 * Whether a registration's modifiers are the ones the keystroke carries, as
 * Obsidian's own keymap compares them: a registration that names none matches
 * a bare key alone, and one that names `null` matches whatever is held.
 */
function heldModifiers(
  modifiers: Modifier[] | null,
  event: KeyboardEvent,
): boolean {
  if (modifiers === null) return true;
  return Object.entries(MODIFIER_HELD).every(
    ([name, held]) => modifiers.includes(name as Modifier) === held(event),
  );
}

/**
 * One keystroke as Obsidian delivers it: the Scope hears it first, and the
 * page hears it only when no handler there took it.
 *
 * The Scope's own search rule is Obsidian's: a registration that answers
 * `false` takes the key, and one that answers nothing ends the search all the
 * same unless it is a catch-all — a registration naming neither key nor
 * modifiers, which the search walks past to whatever stands behind it, and
 * past the last registration to the Scope's parent.
 *
 * @param target where the focus sits, which the Scope reads before the page is
 *   dispatched the event.
 * @see `Scope.handleKey` in Obsidian's own `app.js`.
 */
export function dispatchKey(
  scope: Scope,
  init: KeyboardEventInit,
  target: EventTarget,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "target", { value: target });
  if (handleKey(scope, event) === false) {
    // A registration took the key: Obsidian prevents the event and stops it,
    // so the page never hears it.
    event.preventDefault();
    return event;
  }
  target.dispatchEvent(event);
  return event;
}

/** One Scope's answer to a key: `false` where a registration took it. */
function handleKey(scope: Scope, event: KeyboardEvent): unknown {
  // The mock Scope records its registrations, in the order made.
  const { handlers, parent } = scope as unknown as {
    handlers: {
      modifiers: Modifier[] | null;
      key: string | null;
      func: (evt: KeyboardEvent) => boolean | void;
    }[];
    parent?: Scope;
  };
  for (const { modifiers, key, func } of handlers) {
    if (key !== null && key.toLowerCase() !== event.key.toLowerCase()) continue;
    if (!heldModifiers(modifiers, event)) continue;
    const answer = func(event);
    // A keyed registration ends the search whatever else it answers, so no
    // registration behind it and no parent Scope hears the keystroke. The page
    // hears it all the same unless it answered `false`.
    if (answer !== undefined || key !== null || modifiers !== null)
      return answer;
  }
  return parent && handleKey(parent, event);
}

/** One keystroke through the Scope on top of `app`'s keymap. */
export function pressTop(
  app: { scopes: Scope[] },
  init: KeyboardEventInit,
  target: EventTarget,
): KeyboardEvent {
  const top = app.scopes.at(-1);
  if (!top) throw new Error("No Scope stands on the keymap");
  return dispatchKey(top, init, target);
}
