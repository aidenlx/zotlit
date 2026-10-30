// @vitest-environment happy-dom
import type { EditorView } from "@codemirror/view";
import { Scope } from "obsidian";
import type { Keymap } from "obsidian";
import { expect, it, vi } from "vitest";

import type { FieldPopupKeys } from "@zotlit/workbench/language";

import { stubService } from "./__fixtures__/service-stub";
import { popupScope } from "./field-popup";

/** A keymap that records its stack, and the keys a popup hands it. */
function setup() {
  const stack: Scope[] = [];
  const keymap = stubService<Keymap>("Keymap", {
    pushScope: (scope: Scope) => stack.push(scope),
    popScope: (scope: Scope) => stack.splice(stack.indexOf(scope), 1),
  });
  const migrated: (() => void)[] = [];
  const keys = stubService<FieldPopupKeys>("FieldPopupKeys", {
    view: stubService<EditorView>("EditorView", {
      scrollDOM: Object.assign(document.createElement("div"), {
        onWindowMigrated: (listener: () => void) => {
          migrated.push(listener);
          return () => migrated.splice(migrated.indexOf(listener), 1);
        },
      }),
    }),
    accept: vi.fn(() => true),
    close: vi.fn(() => true),
    released: vi.fn(),
  });
  popupScope({ scope: new Scope(), keymap })(keys);
  return { stack, keys, migrated };
}

/** The test double's Scope, which records its handlers. */
type MockScope = {
  handlers: {
    modifiers: string[] | null;
    key: string | null;
    func: (event: KeyboardEvent) => unknown;
  }[];
};

/** What the Scope's handler of Shift-Tab answers. */
function pressShiftTab(scope: Scope) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true });
  const handler = (scope as unknown as MockScope).handlers.find(
    (entry) => entry.key === "Tab" && entry.modifiers?.join() === "Shift",
  );
  return handler?.func(event);
}

it("gives the keymap back before Shift-Tab moves focus, and tells the field", () => {
  const { stack, keys } = setup();
  expect(pressShiftTab(stack[0]!)).toBeUndefined();
  expect(stack).toHaveLength(0);
  expect(keys.accept).not.toHaveBeenCalled();
  expect(keys.released).toHaveBeenCalledTimes(1);
});

it("pops the Scope when the field moves to another window, and tells the field", () => {
  const { stack, keys, migrated } = setup();
  expect(migrated).toHaveLength(1);
  migrated[0]!();
  expect(stack).toHaveLength(0);
  expect(migrated).toHaveLength(0);
  expect(keys.released).toHaveBeenCalledTimes(1);
});
