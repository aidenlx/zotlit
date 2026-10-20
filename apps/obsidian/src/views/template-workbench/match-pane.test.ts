// @vitest-environment happy-dom
import { StateEffect } from "@codemirror/state";
import { EditorView, showTooltip } from "@codemirror/view";
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
async function mountExpression(within: HTMLElement = document.body) {
  const container = document.createElement("div");
  within.append(container);
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
  // The editor places its tooltips once it stands in the page.
  await act(() => Promise.resolve());
  return {
    dom,
    view: EditorView.findFromDOM(dom)!,
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

/** Opens a placeholder tooltip under the end of the text, as completion will. */
function openTooltip(view: EditorView): HTMLElement {
  const tooltip = document.createElement("div");
  tooltip.dataset.placeholderTooltip = "";
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      showTooltip.of({
        pos: view.state.doc.length,
        create: () => ({ dom: tooltip }),
      }),
    ),
  });
  return tooltip;
}

/**
 * A top-layer surface, such as the Filter popover or the chooser popup, and
 * the box its contents scroll in.
 */
function popover(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("popover", "auto");
  const scroller = document.createElement("div");
  root.append(scroller);
  document.body.append(root);
  return scroller;
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

  it("draw their tooltips in the popover they sit in, outside its scrolling", async () => {
    using _migration = windowMigration();
    const scroller = popover();
    await using editor = await mountExpression(scroller);
    const tooltip = openTooltip(editor.view);
    expect(tooltip.closest("[popover]")).toBe(scroller.parentElement);
    expect(scroller.contains(tooltip)).toBe(false);
    scroller.parentElement!.remove();
  });

  it("draw their tooltips in the page outside a popover", async () => {
    using _migration = windowMigration();
    await using editor = await mountExpression();
    const tooltip = openTooltip(editor.view);
    expect(tooltip.isConnected).toBe(true);
    expect(editor.dom.contains(tooltip)).toBe(false);
    expect(tooltip.closest("[popover]")).toBeNull();
  });

  it("draw their tooltips in the popout window the view moves to", async () => {
    using migration = windowMigration();
    await using editor = await mountExpression();
    const destination = document.implementation.createHTMLDocument();
    destination.body.append(editor.dom.parentElement!);
    migration.move({ document: destination } as Window);
    const tooltip = openTooltip(editor.view);
    expect(destination.body.contains(tooltip)).toBe(true);
    expect(editor.dom.contains(tooltip)).toBe(false);
  });
});
