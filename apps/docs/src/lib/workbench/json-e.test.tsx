// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  entrySlice,
  WorkbenchDocumentController,
} from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import { SliceEditor } from "./slice-editor";

it.each([false, true])(
  "completes a JSON-e rule through the shared source and history (Advanced=%s)",
  async (advanced) => {
    using stack = new DisposableStack();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stack.defer(() => vi.unstubAllGlobals());
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "expr: zt.relatedItems | note_links",
      'value: {"$eval":"zt.key"}',
    ).replace("expr: zt.title", 'value: {"$eval":"zt.ti"}');
    const controller = new WorkbenchDocumentController(source);
    const position = source.indexOf('zt.ti"') + 5;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await act(async () => root.unmount());
      host.remove();
    });
    await act(async () =>
      root.render(
        <SliceEditor
          controller={controller}
          slice={advanced ? "advanced" : entrySlice(1)}
          language={advanced ? "liquid" : "json-e"}
          label="Rule"
          reveal={{ from: position, to: position }}
        />,
      ),
    );
    const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
    expect(host.querySelector(".tok-variableName")?.textContent).toBeTruthy();
    expect(
      [...host.querySelectorAll(".tok-keyword")].some(
        (token) => token.textContent === "$eval",
      ),
    ).toBe(true);
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      ),
    );
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "title",
    );
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(controller.source).toBe(source.replace('zt.ti"', 'zt.title"'));
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      controller.undo();
    });
    expect(controller.source).toBe(source);
    const original = '{"$eval":"zt.ti"}';
    const replacement = JSON.stringify(
      // oxlint-disable-next-line unicorn/no-thenable -- JSON-e names the branch then.
      { $if: "true", then: "${zt.title}", else: "literal" },
      null,
      advanced ? undefined : 2,
    );
    const view = EditorView.findFromDOM(editor)!;
    const from = advanced ? source.indexOf(original) : 0;
    await act(async () =>
      view.dispatch({
        changes: { from, to: from + original.length, insert: replacement },
      }),
    );
    expect(
      [...host.querySelectorAll(".tok-keyword")].some(
        (token) => token.textContent === "then",
      ),
    ).toBe(true);
    expect(
      [...host.querySelectorAll(".tok-operator")].some(
        (token) => token.textContent === "${",
      ),
    ).toBe(true);
  },
);
