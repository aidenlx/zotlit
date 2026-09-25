// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";
import { createCommentEditor } from "@/views/annot-view/comment-editor";

import { annotation, pageView, readerOverZotero } from "./__fixtures__";
import { historyVerbOf } from "./reader-keymap";
import type { OverlayPageView } from "./render";
import { createTextDraftArea } from "./text-draft";

const MARK: AnnotationRecord = annotation("PARA7777", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});

/** The reader surfaces of one PDF view on one platform. */
async function setup(isMacOS: boolean) {
  const stack = new AsyncDisposableStack();
  const containerEl = document.body.appendChild(document.createElement("div"));
  stack.defer(() => containerEl.remove());
  const page = pageView();
  containerEl.append(page.div);
  const reader = await readerOverZotero(stack, {
    containerEl,
    page: page as unknown as OverlayPageView,
    records: [MARK],
    isMacOS,
  });
  return {
    ...reader,
    containerEl,
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

/** Every chord the two platforms are asked about, by the name a reader reads. */
const CHORDS: Readonly<Record<string, KeyboardEventInit>> = {
  "Ctrl+Z": { key: "z", ctrlKey: true },
  "Ctrl+Shift+Z": { key: "z", ctrlKey: true, shiftKey: true },
  "Ctrl+Y": { key: "y", ctrlKey: true },
  "Command+Z": { key: "z", metaKey: true },
  "Command+Shift+Z": { key: "z", metaKey: true, shiftKey: true },
  "Command+Y": { key: "y", metaKey: true },
  "Alt+Command+Z": { key: "z", metaKey: true, altKey: true },
  "Alt+Ctrl+Z": { key: "z", ctrlKey: true, altKey: true },
  Z: { key: "z" },
  Y: { key: "y" },
};

function decisions(isMacOS: boolean): Record<string, string> {
  return Object.fromEntries(
    Object.entries(CHORDS).map(([name, init]) => [
      name,
      historyVerbOf(
        {
          key: init.key!,
          ctrlKey: init.ctrlKey ?? false,
          metaKey: init.metaKey ?? false,
          altKey: init.altKey ?? false,
          shiftKey: init.shiftKey ?? false,
        },
        isMacOS,
      ) ?? "pass",
    ]),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("reads Command+Z and Command+Shift+Z as the history keys on macOS", () => {
  expect(decisions(true)).toEqual({
    "Command+Z": "undo",
    "Command+Shift+Z": "redo",
    // Mod+Y is not a macOS redo, and Ctrl is not the platform key there.
    "Command+Y": "pass",
    "Ctrl+Z": "pass",
    "Ctrl+Shift+Z": "pass",
    "Ctrl+Y": "pass",
    "Alt+Command+Z": "pass",
    "Alt+Ctrl+Z": "pass",
    Z: "pass",
    Y: "pass",
  });
});

it("reads Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y as the history keys elsewhere", () => {
  expect(decisions(false)).toEqual({
    "Ctrl+Z": "undo",
    "Ctrl+Shift+Z": "redo",
    "Ctrl+Y": "redo",
    // The Command key is no platform key off macOS.
    "Command+Z": "pass",
    "Command+Shift+Z": "pass",
    "Command+Y": "pass",
    "Alt+Command+Z": "pass",
    "Alt+Ctrl+Z": "pass",
    Z: "pass",
    Y: "pass",
  });
});

it("runs the platform's own history keys and leaves the other platform's", async () => {
  await using mac = await setup(true);
  mac.key({ key: "z", metaKey: true });
  mac.key({ key: "z", metaKey: true, shiftKey: true });
  mac.key({ key: "z", ctrlKey: true });
  mac.key({ key: "y", ctrlKey: true });
  expect(mac.stepped).toEqual(["undo", "redo"]);

  await using pc = await setup(false);
  pc.key({ key: "z", ctrlKey: true });
  pc.key({ key: "z", ctrlKey: true, shiftKey: true });
  pc.key({ key: "y", ctrlKey: true });
  pc.key({ key: "z", metaKey: true });
  expect(pc.stepped).toEqual(["undo", "redo", "redo"]);
});

it("takes the key that acted, and leaves the one it did not", async () => {
  await using h = await setup(false);

  expect(h.key({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
  expect(h.key({ key: "z", metaKey: true }).defaultPrevented).toBe(false);
});

it("steps once for a held key", async () => {
  await using h = await setup(false);

  h.key({ key: "z", ctrlKey: true });
  h.key({ key: "z", ctrlKey: true, repeat: true });
  h.key({ key: "z", ctrlKey: true, repeat: true });

  expect(h.stepped).toEqual(["undo"]);
});

it("leaves the history keys to a text field they were typed into", async () => {
  await using h = await setup(false);
  const textarea = h.containerEl.appendChild(
    document.createElement("textarea"),
  );

  h.key({ key: "z", ctrlKey: true }, textarea);
  h.key({ key: "y", ctrlKey: true }, textarea);

  expect(h.stepped).toEqual([]);
});

it("leaves the history keys to the comment editor holding focus", async () => {
  await using h = await setup(false);
  const parent = h.containerEl.appendChild(document.createElement("div"));
  using editor = createCommentEditor({
    app: editorApp(),
    parent,
    text: "Worth citing",
    readOnly: false,
    onChange: vi.fn(),
    onEscape: vi.fn(),
    onSubmit: vi.fn(),
    onBlur: vi.fn(),
  });
  const { view } = editor;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " twice" },
    userEvent: "input.type",
  });

  h.key({ key: "z", ctrlKey: true }, view.contentDOM);

  // The editor's own text undo took the chord: the typed run is gone and the
  // Annotation History never heard the key.
  expect(view.state.doc.toString()).toBe("Worth citing");
  expect(h.stepped).toEqual([]);

  // The very same chord away from the editor is the reader's own.
  h.key({ key: "z", ctrlKey: true });
  expect(h.stepped).toEqual(["undo"]);
});

it("leaves the history keys to a Text Draft holding focus", async () => {
  await using h = await setup(false);
  const area = h.containerEl.appendChild(
    createTextDraftArea(document, { input: vi.fn(), finish: vi.fn() }),
  );

  h.key({ key: "z", ctrlKey: true }, area);
  h.key({ key: "y", ctrlKey: true }, area);
  expect(h.stepped).toEqual([]);

  h.key({ key: "y", ctrlKey: true });
  expect(h.stepped).toEqual(["redo"]);
});
