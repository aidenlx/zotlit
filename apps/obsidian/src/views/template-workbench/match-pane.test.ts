// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import { CODE_PANE_CLASS } from "./editor-extension";
import { matchTheme } from "./match-pane";

const onWindowMigrated = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "onWindowMigrated",
);
let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
  if (onWindowMigrated) {
    Object.defineProperty(
      HTMLElement.prototype,
      "onWindowMigrated",
      onWindowMigrated,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "onWindowMigrated");
  }
});

function migrationHost() {
  let migrate: ((win: Window) => void) | null = null;
  Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
    configurable: true,
    value: (listener: (win: Window) => void) => {
      migrate = listener;
      return () => {};
    },
  });
  return { move: (win: Window) => migrate?.(win) };
}

/** An expression editor under the theme the Match editor and Formula use. */
async function mountExpression() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => {
    root.render(
      createElement(
        WorkbenchThemeProvider,
        { theme: matchTheme },
        createElement(MatchExpressionInput, {
          value: "itemType == 'book'",
          onChange: () => {},
        }),
      ),
    );
  });
  unmount = async () => {
    await act(() => root.unmount());
    container.remove();
  };
  const dom = container.querySelector<HTMLElement>(".cm-editor")!;
  return { dom, view: EditorView.findFromDOM(dom)! };
}

describe("expression editors in Obsidian", () => {
  it("wear the code pane the template editor wears", async () => {
    migrationHost();
    const { dom } = await mountExpression();
    expect(dom.classList.contains(CODE_PANE_CLASS)).toBe(true);
  });

  it("move their styles along when the view moves to a popout window", async () => {
    const host = migrationHost();
    const { view } = await mountExpression();
    const destination = document.implementation.createHTMLDocument();
    const setRoot = vi.spyOn(view, "setRoot");
    host.move({ document: destination } as Window);
    expect(setRoot).toHaveBeenCalledWith(destination);
  });
});
