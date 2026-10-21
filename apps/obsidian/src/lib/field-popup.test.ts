// @vitest-environment happy-dom
import { Scope } from "obsidian";
import type { Keymap } from "obsidian";
import { expect, it, vi } from "vitest";

import type { FieldPopupKeys } from "@zotlit/workbench/language";

import { popupScope } from "./field-popup";

/** A keymap that records its stack, and the keys a popup hands it. */
function setup({ accepts = true, closes = true } = {}) {
  const stack: Scope[] = [];
  const keymap = {
    pushScope: (scope: Scope) => stack.push(scope),
    popScope: (scope: Scope) => stack.splice(stack.indexOf(scope), 1),
  } as unknown as Keymap;
  const keys = {
    view: null,
    accept: vi.fn(() => accepts),
    close: vi.fn(() => closes),
  } as unknown as FieldPopupKeys;
  const release = popupScope({ scope: new Scope(), keymap })(keys);
  return { stack, keys, release };
}

/** The test double's Scope, which records its handlers. */
type MockScope = {
  handlers: {
    modifiers: string[] | null;
    key: string | null;
    func: (event: KeyboardEvent) => unknown;
  }[];
};

/** What the Scope's handler of `key` answers. */
function press(
  scope: Scope,
  key: string,
  { shift = false, isComposing = false } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: shift,
    isComposing,
  });
  const modifiers = shift ? ["Shift"] : [];
  const handler = (scope as unknown as MockScope).handlers.find(
    (entry) =>
      entry.key === key && entry.modifiers?.join() === modifiers.join(),
  );
  return handler?.func(event);
}

it("pushes a Scope while the popup stands and pops it once", () => {
  const { stack, release } = setup();
  expect(stack).toHaveLength(1);
  release();
  release();
  expect(stack).toHaveLength(0);
});

it("takes Tab and Enter for the option and Escape for closing", () => {
  const { stack, keys } = setup();
  const [scope] = stack;
  expect(press(scope!, "Tab")).toBe(false);
  expect(press(scope!, "Enter")).toBe(false);
  expect(keys.accept).toHaveBeenCalledTimes(2);
  expect(press(scope!, "Escape")).toBe(false);
  expect(keys.close).toHaveBeenCalledTimes(1);
});

it("leaves a key the popup did not act on, or a composing one, to the field", () => {
  const { stack, keys } = setup({ accepts: false, closes: false });
  const [scope] = stack;
  expect(press(scope!, "Tab")).toBeUndefined();
  expect(press(scope!, "Escape")).toBeUndefined();
  expect(press(scope!, "Enter", { isComposing: true })).toBeUndefined();
  expect(keys.accept).toHaveBeenCalledTimes(1);
});

it("gives the keymap back before Shift-Tab moves focus", () => {
  const { stack, keys } = setup();
  expect(press(stack[0]!, "Tab", { shift: true })).toBeUndefined();
  expect(stack).toHaveLength(0);
  expect(keys.accept).not.toHaveBeenCalled();
});
