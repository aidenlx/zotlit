// @vitest-environment happy-dom
// The docked Fields Panel's keys: while focus is in the panel, Mod+Enter and
// Escape reach the panel's own handlers, and no hotkey of Obsidian's takes
// them.
import { afterEach, expect, it, vi } from "vitest";

import { keymapApp, pressTop } from "@/lib/__fixtures__/keymap";

import { fieldsActionHost } from "./fields-popover";

afterEach(() => {
  document.body.replaceChildren();
});

function docked() {
  const app = keymapApp();
  const hotkey = vi.fn(() => false);
  app.scope.register(["Mod"], "Enter", hotkey);
  app.scope.register([], "Escape", hotkey);
  const action = fieldsActionHost(
    { current: null },
    { current: null },
    app as never,
  );
  const panel = document.body.appendChild(document.createElement("div"));
  const search = panel.appendChild(document.createElement("input"));
  const outside = document.body.appendChild(document.createElement("input"));
  const release = action.holdKeys!(panel);
  return { app, hotkey, panel, search, outside, release };
}

it("lets the panel hear Mod+Enter and Escape while focus is in it", () => {
  const { app, hotkey, search, release } = docked();
  search.focus();
  const heard = vi.fn();
  search.addEventListener("keydown", heard);
  const insert = pressTop(app, { key: "Enter", ctrlKey: true }, search);
  const escape = pressTop(app, { key: "Escape" }, search);
  expect(hotkey).not.toHaveBeenCalled();
  expect(insert.defaultPrevented).toBe(false);
  expect(escape.defaultPrevented).toBe(false);
  expect(heard).toHaveBeenCalledTimes(2);
  release();
  expect(app.scopes).toEqual([]);
});

it("holds no keys while focus is outside the panel, or once released", () => {
  const { app, search, outside, release } = docked();
  expect(app.scopes).toEqual([]);
  search.focus();
  expect(app.scopes).toHaveLength(1);
  outside.focus();
  expect(app.scopes).toEqual([]);
  search.focus();
  release();
  expect(app.scopes).toEqual([]);
  search.blur();
  search.focus();
  expect(app.scopes).toEqual([]);
});
