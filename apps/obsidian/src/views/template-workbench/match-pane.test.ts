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
  return {
    dom,
    view: EditorView.findFromDOM(dom)!,
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Opens a placeholder tooltip under the end of the text, as completion will
 * once the user types in the field, which then holds focus.
 * @returns The tooltip, once the field has placed it outside its own box.
 */
async function openTooltip(view: EditorView): Promise<HTMLElement> {
  view.focus();
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
  // The field places its tooltips once CodeMirror has told it of the focus.
  await vi.waitFor(() => expect(view.dom.contains(tooltip)).toBe(false));
  return tooltip;
}

/**
 * A top-layer surface in the page, such as the Filter popover or the chooser
 * popup: its root, and the box its contents scroll in.
 */
function popoverSurface() {
  const root = document.createElement("div");
  root.setAttribute("popover", "auto");
  const scroller = document.createElement("div");
  root.append(scroller);
  document.body.append(root);
  return {
    root,
    scroller,
    [Symbol.dispose]: () => root.remove(),
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

  it("draw their tooltips in the popover they sit in, outside its scrolling", async () => {
    using _migration = windowMigration();
    using surface = popoverSurface();
    await using editor = await mountExpression(surface.scroller);
    const tooltip = await openTooltip(editor.view);
    expect(tooltip.closest("[popover]")).toBe(surface.root);
    expect(surface.scroller.contains(tooltip)).toBe(false);
  });

  it("draw their tooltips in the page outside a popover", async () => {
    using _migration = windowMigration();
    await using editor = await mountExpression();
    const tooltip = await openTooltip(editor.view);
    expect(tooltip.isConnected).toBe(true);
    expect(editor.dom.contains(tooltip)).toBe(false);
    expect(tooltip.closest("[popover]")).toBeNull();
  });

  it("keep CodeMirror's notice of the focus while they place their tooltips", async () => {
    using _migration = windowMigration();
    using surface = popoverSurface();
    await using editor = await mountExpression(surface.scroller);
    // What reaches the editor's state, not what CodeMirror composes.
    const noticed = StateEffect.define<boolean>();
    const notices: boolean[] = [];
    editor.view.dispatch({
      effects: StateEffect.appendConfig.of([
        EditorView.focusChangeEffect.of((_state, focus) => noticed.of(focus)),
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions)
            for (const effect of tr.effects)
              if (effect.is(noticed)) notices.push(effect.value);
        }),
      ]),
    });
    // A click focuses the field and puts the caret in the same task.
    editor.view.focus();
    editor.view.dispatch({ selection: { anchor: 1 } });
    await vi.waitFor(() => expect(notices).toEqual([true]));
  });

  it("draw their tooltips in the popout window the view moves to", async () => {
    using migration = windowMigration();
    await using editor = await mountExpression();
    // The field was in use in the main window before the view moved.
    editor.view.focus();
    const destination = document.implementation.createHTMLDocument();
    destination.body.append(editor.dom.parentElement!);
    migration.move({ document: destination } as Window);
    const tooltip = await openTooltip(editor.view);
    expect(destination.body.contains(tooltip)).toBe(true);
    expect(editor.dom.contains(tooltip)).toBe(false);
  });
});
