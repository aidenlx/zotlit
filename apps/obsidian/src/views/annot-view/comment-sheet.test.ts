// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { editorApp, pressSubmit } from "./__fixtures__/editor-app";
import { commentField, renderEditorSheet } from "./comment-sheet";
import type {
  EditorSheetProps,
  EditorSheetStatus,
  CommentSurface,
} from "./comment-sheet";

const AUTOMATIC: EditorSheetStatus = {
  hint: null,
  manual: false,
  readOnly: false,
  saveDisabled: false,
};

/** One mounted sheet, torn down with its node and the scope it pushed. */
function sheet(
  props: Partial<Omit<EditorSheetProps, "app">> = {},
  status: EditorSheetStatus = AUTOMATIC,
) {
  const app = editorApp();
  const el = document.body.appendChild(document.createElement("div"));
  const built = renderEditorSheet(
    el,
    {
      app,
      surface: "popup",
      field: commentField(),
      value: "",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      onDone: vi.fn(),
      ...props,
    },
    status,
  );
  return {
    app,
    el,
    sheet: built,
    [Symbol.dispose]() {
      built[Symbol.dispose]();
      el.remove();
    },
  };
}

it("submits on Mod+Enter through the scope it holds while focused, and lets it go", () => {
  const onSubmit = vi.fn();
  const mounted = sheet({ onSubmit });

  pressSubmit(mounted.app);
  expect(onSubmit).toHaveBeenCalledOnce();

  mounted[Symbol.dispose]();
  expect(mounted.app.scopes).toEqual([]);
});

/** The sheet's button that reads `label`. */
function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`No button reads ${label}`);
  return found;
}

it("still submits on Mod+Enter and steps back on Escape beside Done", () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onDone = vi.fn();
  using mounted = sheet({ onSubmit, onCancel, onDone });

  pressSubmit(mounted.app);
  mounted.sheet.editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onDone).not.toHaveBeenCalled();
});

it("names the field it edits in its placeholder, its accessible name and its Save button", () => {
  using mounted = sheet({
    field: {
      placeholder: "Add the quoted text…",
      label: "Edit quoted text",
      save: "Save text",
    },
  });
  const { contentDOM, dom } = mounted.sheet.editor.view;

  expect(contentDOM.getAttribute("aria-label")).toBe("Edit quoted text");
  expect(dom.querySelector(".cm-placeholder")?.textContent).toBe(
    "Add the quoted text…",
  );
  expect(button(mounted.el, "Save text")).toBeDefined();
});

it("steps back on Escape", () => {
  const onCancel = vi.fn();
  using mounted = sheet({ onCancel });

  mounted.sheet.editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(onCancel).toHaveBeenCalledOnce();
});

it("saves on leaving only while the save is automatic and the editor writes", () => {
  const onLeave = vi.fn();
  using mounted = sheet(
    { surface: "card", onLeave },
    {
      ...AUTOMATIC,
      manual: true,
    },
  );
  const leave = () =>
    mounted.sheet.editor.view.contentDOM.dispatchEvent(new FocusEvent("blur"));

  leave();
  mounted.sheet.update({ ...AUTOMATIC, readOnly: true, saveDisabled: true });
  leave();
  mounted.sheet.update(AUTOMATIC);
  leave();

  expect(onLeave).toHaveBeenCalledOnce();
});

it("opens the sheet on the comment already typed", () => {
  using mounted = sheet({ value: "kept across a redraw" });

  expect(mounted.sheet.text()).toBe("kept across a redraw");
});

it.each([
  ["popup", true],
  ["card", false],
] satisfies [CommentSurface, boolean][])(
  "promises the comment sheet's theme hook by its literal name on the %s",
  (surface, hooked) => {
    // The name itself is the public surface, so the literal is the test.
    // @see apps/obsidian/policies/theme-hooks.md
    using mounted = sheet({ surface });

    expect(mounted.el.classList.contains("zt-pdf-comment-sheet")).toBe(hooked);
  },
);
