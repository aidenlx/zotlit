// @vitest-environment happy-dom
import { Scope } from "obsidian";
import { afterEach, expect, it } from "vitest";

import { keymapApp } from "./__fixtures__/keymap";
import { holdScopeWhileFocused } from "./focus-scope";

afterEach(() => {
  document.body.empty();
});

/** A layer with two controls inside it, and one control outside it. */
function layer() {
  const el = document.body.createDiv();
  const first = el.createEl("button");
  const second = el.createEl("button");
  const outside = document.body.createEl("button");
  return { el, first, second, outside };
}

it("holds the Scope while focus stands inside, and gives it back as focus leaves", () => {
  const app = keymapApp();
  const { el, first, second, outside } = layer();
  const scope = new Scope();
  using _held = holdScopeWhileFocused(el, scope, { keymap: app.keymap });
  expect(app.scopes).toEqual([]);

  first.focus();
  expect(app.scopes).toEqual([scope]);
  second.focus();
  expect(app.scopes).toEqual([scope]);
  outside.focus();
  expect(app.scopes).toEqual([]);
});

it("pushes at once for focus already inside, and gives the Scope back on dispose", () => {
  const app = keymapApp();
  const { el, first } = layer();
  first.focus();
  const scope = new Scope();
  {
    using _held = holdScopeWhileFocused(el, scope, { keymap: app.keymap });
    expect(app.scopes).toEqual([scope]);
  }
  expect(app.scopes).toEqual([]);
});

it("stays above a Scope the surface around it pushes as the same focus comes down", () => {
  const app = keymapApp();
  const { el, first, second } = layer();
  const surface = new Scope();
  // A surface that pushes its own Scope on focus that is not in a field.
  document.body.addEventListener(
    "focusin",
    (event) => {
      if (event.target !== second || app.scopes.includes(surface)) return;
      app.keymap.pushScope(surface);
    },
    true,
  );
  const scope = new Scope();
  using _held = holdScopeWhileFocused(el, scope, { keymap: app.keymap });
  first.focus();
  second.focus();
  expect(app.scopes).toEqual([surface, scope]);
});

it("pushes only while the layer stands", () => {
  const app = keymapApp();
  const { el, first, second } = layer();
  let open = false;
  const scope = new Scope();
  using _held = holdScopeWhileFocused(el, scope, {
    keymap: app.keymap,
    when: () => open,
  });
  first.focus();
  expect(app.scopes).toEqual([]);
  open = true;
  second.focus();
  expect(app.scopes).toEqual([scope]);
});

it("gives the Scope back when the layer moves to another window", () => {
  const app = keymapApp();
  const { el, first } = layer();
  let migrated: (() => void) | undefined;
  el.onWindowMigrated = (listener) => {
    migrated = () => listener(window);
    return () => (migrated = undefined);
  };
  const scope = new Scope();
  const held = holdScopeWhileFocused(el, scope, { keymap: app.keymap });
  first.focus();
  expect(app.scopes).toEqual([scope]);
  migrated!();
  expect(app.scopes).toEqual([]);
  held[Symbol.dispose]();
  expect(migrated).toBeUndefined();
});
