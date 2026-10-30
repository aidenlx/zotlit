// @vitest-environment happy-dom
import { controlsOf } from "@mock/obsidian";
import type { ToggleComponent } from "@mock/obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { Toggle } from "./toggle";

it("syncs props without emitting changes, forwards native changes, and disposes the control", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const changed = vi.fn();
  const render = (value: boolean, disabled = false) =>
    act(async () => {
      root.render(
        createElement(Toggle, {
          value,
          disabled,
          onChange: changed,
          "aria-label": "Import highlights",
        }),
      );
    });
  await render(false);
  const host = container.firstElementChild as HTMLElement;
  const toggle = controlsOf(host)[0] as ToggleComponent;
  await render(true);
  expect(controlsOf(host)).toHaveLength(1);
  expect(toggle.getValue()).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  toggle.toggle(false);
  expect(changed.mock.calls).toEqual([[false]]);
  await render(false, true);
  expect(toggle.disabled).toBe(true);
  const element = toggle.toggleEl;
  root.unmount();
  expect(element.parentElement).toBeNull();
});
