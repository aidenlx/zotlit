// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { expect, it, vi } from "vitest";

import {
  WorkbenchDocumentController,
  workbenchSlice,
} from "@zotlit/workbench/document";
import { liquidMarkdown, templatePairing } from "@zotlit/workbench/language";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import { webCompletion } from "./completion";

it("accepts a field with editor focus retained and undoes only the completion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const range = original.sliceRange("note");
  const controller = new WorkbenchDocumentController(
    `${DEFAULT_PROFILE_SOURCE.slice(0, range.from)}{{ zt.t }}\n${DEFAULT_PROFILE_SOURCE.slice(range.to)}`,
  );
  const view = new EditorView({
    state: EditorState.create({
      doc: controller.sliceText("note"),
      extensions: [
        workbenchSlice(controller, "note"),
        webCompletion(() => ({ root: "note", partials: [] })),
      ],
    }),
    parent: document.body,
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await act(async () => view.destroy());
  });
  await act(async () => {
    view.focus();
    view.dispatch({
      changes: { from: 7, insert: "i" },
      selection: { anchor: 8 },
      userEvent: "input.type",
    });
  });
  expect(document.querySelector('[role="option"]')?.textContent).toContain(
    "title",
  );
  expect(view.hasFocus).toBe(true);
  const before = controller.source;
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(view.state.doc.toString()).toBe("{{ zt.title }}\n");
  expect(view.hasFocus).toBe(true);
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(controller.undo()).toBe(true);
  expect(controller.source).toBe(before);
});

it("pairs typed delimiters, dismisses completion on a closer, and keeps composition Enter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const read = () => ({
    root: "note" as const,
    language: "liquid" as const,
    partials: [],
  });
  const view = new EditorView({
    state: EditorState.create({
      extensions: [liquidMarkdown, templatePairing(read), webCompletion(read)],
    }),
    parent: document.body,
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await act(async () => view.destroy());
  });
  const type = async (text: string) => {
    await act(async () => {
      const { from, to } = view.state.selection.main;
      const insert = () =>
        view.state.update({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input.type",
        });
      if (
        !view.state
          .facet(EditorView.inputHandler)
          .some((handler) => handler(view, from, to, text, insert))
      )
        view.dispatch(insert());
    });
  };
  await act(async () => view.focus());
  await type("{");
  await type("{");
  await type("zt.ti");
  expect(document.querySelector('[role="option"]')?.textContent).toContain(
    "title",
  );
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(view.state.doc.toString()).toBe("{{ zt.ti }}");
  await type("}");
  expect(view.state.doc.toString()).toBe("{{ zt.ti }}");
  expect(view.state.selection.main.head).toBe(10);
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(view.hasFocus).toBe(true);
  await type("}");
  await type(" ");
  await type("{");
  await type("{");
  await type("zt.ti");
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(view.state.doc.toString()).toBe("{{ zt.ti }} {{ zt.title }}");
  expect(view.state.selection.main.head).toBe(26);
  expect(view.hasFocus).toBe(true);
});
