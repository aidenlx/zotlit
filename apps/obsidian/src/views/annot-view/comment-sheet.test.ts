// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { editorApp, pressSubmit } from "./__fixtures__/editor-app";
import { renderCommentSheet } from "./comment-sheet";
import type {
  CommentSheetProps,
  CommentSheetStatus,
  CommentSurface,
} from "./comment-sheet";

const AUTOMATIC: CommentSheetStatus = {
  hint: null,
  manual: false,
  readOnly: false,
  saveDisabled: false,
};

/** One mounted sheet, torn down with its node and the scope it pushed. */
function sheet(
  props: Partial<Omit<CommentSheetProps, "app">> = {},
  status: CommentSheetStatus = AUTOMATIC,
) {
  const app = editorApp();
  const el = document.body.appendChild(document.createElement("div"));
  const built = renderCommentSheet(
    el,
    {
      app,
      surface: "popup",
      value: "",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
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
