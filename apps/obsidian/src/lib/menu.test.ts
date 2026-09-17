// @vitest-environment happy-dom
// The anchor is read off a real element's rect, so this needs a DOM.
import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { showMenuAtButton } from "./menu";

/** A trigger whose box is known, the way layout would have measured it. */
function trigger(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const el = document.createElement("button");
  document.body.append(el);
  el.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }) as DOMRect;
  return el;
}

const BUTTON = { x: 788, y: 48, width: 42, height: 24 };

beforeEach(() => {
  Menu.instances.length = 0;
  document.body.replaceChildren();
});

describe("showMenuAtButton", () => {
  it("opens under the trigger, not wherever a pointer happened to be", () => {
    const el = trigger(BUTTON);
    const menu = new Menu();

    showMenuAtButton(menu as never, el);

    // `y` is the trigger's bottom edge, so the menu hangs below the control;
    // Obsidian adds its own 2px gap from there.
    expect(menu.position).toStrictEqual({
      x: BUTTON.x,
      y: BUTTON.y + BUTTON.height,
      width: BUTTON.width,
      overlap: true,
      left: false,
    });
  });

  it("lines a right-hand control's menu up with the control's right edge", () => {
    const menu = new Menu();

    showMenuAtButton(menu as never, trigger(BUTTON), "end");

    expect(menu.position?.left).toBe(true);
  });

  it("marks the trigger, so the theme can show it pressed and the menu can follow it", () => {
    const el = trigger(BUTTON);
    const menu = new Menu();

    showMenuAtButton(menu as never, el);

    expect(menu.parentEl).toBe(el);
  });

  it("opens in the trigger's own window, which a pop-out host depends on", () => {
    const el = trigger(BUTTON);
    const menu = new Menu();

    showMenuAtButton(menu as never, el);

    expect(menu.positionDoc).toBe(el.ownerDocument);
  });
});
