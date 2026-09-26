// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { TextField } from "@/services/annotation-repository/service";
import { TEXT_FIELDS } from "@/services/annotation-repository/write";

import { editorApp, pressSubmit } from "./__fixtures__/editor-app";
import { textFieldWording } from "./card-controls";
import { renderEditorSheet } from "./editor-sheet";
import type {
  EditorSheetProps,
  EditorSheetStatus,
  EditorSurface,
} from "./editor-sheet";

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
      field: textFieldWording("comment"),
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

it.each(TEXT_FIELDS)(
  "still submits on Mod+Enter and steps back on Escape beside Done, for the %s",
  (field: TextField) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onDone = vi.fn();
    using mounted = sheet({
      field: textFieldWording(field),
      onSubmit,
      onCancel,
      onDone,
    });

    pressSubmit(mounted.app);
    mounted.sheet.editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  },
);

it.each(TEXT_FIELDS)(
  "hands a Done click to Done alone, for the %s",
  (field: TextField) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onDone = vi.fn();
    using mounted = sheet({
      field: textFieldWording(field),
      onSubmit,
      onCancel,
      onDone,
    });

    button(mounted.el, m.annot_view_editor_done()).click();

    expect(onDone).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  },
);

it("names the Quoted Text in its placeholder, its accessible name and its Save button", () => {
  using mounted = sheet({ field: textFieldWording("text") });
  const { contentDOM, dom } = mounted.sheet.editor.view;

  expect(contentDOM.getAttribute("aria-label")).toBe(
    m.annot_view_card_text_label(),
  );
  expect(dom.querySelector(".cm-placeholder")?.textContent).toBe(
    m.annot_view_card_text_placeholder(),
  );
  expect(button(mounted.el, m.annot_view_text_save())).toBeDefined();
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
] satisfies [EditorSurface, boolean][])(
  "promises the comment sheet's theme hook by its literal name on the %s",
  (surface, hooked) => {
    // The name itself is the public surface, so the literal is the test.
    // @see apps/obsidian/policies/theme-hooks.md
    using mounted = sheet({ surface });

    expect(mounted.el.classList.contains("zt-pdf-comment-sheet")).toBe(hooked);
  },
);
