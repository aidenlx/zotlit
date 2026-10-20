// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import { CODE_PANE_CLASS } from "./editor-extension";
import { matchTheme } from "./match-pane";
import { windowMigration } from "./test-window-migration";

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
  const dom = container.querySelector<HTMLElement>(".cm-editor")!;
  return {
    dom,
    view: EditorView.findFromDOM(dom)!,
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

describe("expression editors in Obsidian", () => {
  it("keep their own text font rather than the template panes' code font", async () => {
    using _migration = windowMigration();
    await using editor = await mountExpression();
    expect(editor.dom.classList.contains(CODE_PANE_CLASS)).toBe(false);
  });

  it("move their styles along when the view moves to a popout window", async () => {
    using migration = windowMigration();
    await using editor = await mountExpression();
    const destination = document.implementation.createHTMLDocument();
    const setRoot = vi.spyOn(editor.view, "setRoot");
    migration.move({ document: destination } as Window);
    expect(setRoot).toHaveBeenCalledWith(destination);
  });
});
