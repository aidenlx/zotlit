// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { NoteFeature } from "@/services/note-feature";
import { ProfileAnnotationError } from "@/services/template/service";

import { createInsertHandler } from "./drag-insert";

const card: AnnotationRecord = {
  key: "PUPR5FG5",
  parentKey: "RGRPDF24",
  type: "image",
  color: null,
  text: null,
  comment: null,
  pageLabel: "1",
  tags: [],
  version: 2,
  position: { kind: "pdf-rects", pageIndex: 0, rects: [[1, 2, 3, 4]] },
};
type Result = Awaited<ReturnType<NoteFeature["prepareAnnotationInsert"]>>;
function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const cm = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "one two",
      selection: { anchor: 4, head: 7 },
      extensions: [history()],
    }),
  });
  const info = {
    file: { path: "Target.md" } as TFile,
    editor: { cm } as Editor,
  } as MarkdownFileInfo;
  const listeners = new Set<() => void>();
  const workspace = {
    activeEditor: info,
    on: (_event: string, cb: () => void) => {
      listeners.add(cb);
      return cb;
    },
    offref: (cb: () => void) => listeners.delete(cb),
  };
  const pending: ReturnType<typeof Promise.withResolvers<Result>>[] = [];
  const prepare = vi.fn<NoteFeature["prepareAnnotationInsert"]>(() => {
    const request = Promise.withResolvers<Result>();
    pending.push(request);
    return request.promise;
  });
  const notify = vi.fn();
  const insert = createInsertHandler({
    app: { workspace } as unknown as App,
    noteFeature: { prepareAnnotationInsert: prepare },
    notify,
    snapshot: () => ({
      source: { kind: "zotero-local-api", serverID: "SERVER000001" },
      sourceScope: "/zotero",
    }),
  });
  return {
    cm,
    info,
    workspace,
    prepare,
    notify,
    insert,
    pending,
    changed: () => {
      for (const cb of listeners) cb();
    },
    [Symbol.dispose]() {
      insert.cancel();
      cm.destroy();
      host.remove();
    },
  };
}
const result = (text: string): Result => ({
  text,
  summary: { zotero: 0, unchecked: 0, unavailable: 0 },
});

it("keeps the established text fallback for a Profile error", async () => {
  using f = fixture();
  const operation = f.insert({
    ...card,
    type: "highlight",
    text: "Original highlight",
  });
  f.pending[0]!.reject(
    new ProfileAnnotationError({
      code: "missing-literature-note-template",
      document: "missing.md",
      hint: "Restore the document",
    }),
  );
  await operation;
  expect(f.cm.state.doc.toString()).toBe("one Original highlight");
  expect(f.notify).toHaveBeenCalledTimes(1);
});

it("supersedes the pending action and inserts once with one undo", async () => {
  using f = fixture();
  const first = f.insert(card);
  const second = f.insert(card);
  expect(f.prepare.mock.calls[0]?.[0].signal.aborted).toBe(true);
  f.cm.dispatch({ changes: { from: 0, insert: "user " } });
  f.pending[1]!.resolve(result("EXCERPT"));
  await second;
  f.pending[0]!.resolve(result("STALE"));
  await first;
  expect(f.cm.state.doc.toString()).toBe("user one EXCERPT");
  expect(f.notify).not.toHaveBeenCalled();
  undo(f.cm);
  expect(f.cm.state.doc.toString()).toBe("user one two");
});
it.each(["switch", "close", "cancel"])(
  "cancels the action after target %s",
  async (mode) => {
    using f = fixture();
    const operation = f.insert(card);
    if (mode === "switch") {
      f.workspace.activeEditor = {
        file: { path: "Other.md" } as TFile,
        editor: {} as Editor,
      } as MarkdownFileInfo;
      f.changed();
      f.workspace.activeEditor = f.info;
    }
    if (mode === "close") f.cm.dom.remove();
    if (mode === "cancel") f.insert.cancel();
    f.pending[0]!.resolve(result("late"));
    await operation;
    expect(f.cm.state.doc.toString()).toBe("one two");
    expect(f.notify).not.toHaveBeenCalled();
  },
);
it("reports an unavailable result once after insertion", async () => {
  using f = fixture();
  const operation = f.insert(card);
  f.pending[0]!.resolve({
    text: "Image unavailable [Zotero](zotero://open)",
    summary: { zotero: 0, unchecked: 0, unavailable: 1 },
  });
  await operation;
  expect(f.cm.state.doc.toString()).toBe(
    "one Image unavailable [Zotero](zotero://open)",
  );
  expect(f.notify).toHaveBeenCalledTimes(1);
});
it("uses a source-link fallback when preparation cannot build template context", async () => {
  using f = fixture();
  const operation = f.insert(card);
  f.pending[0]!.resolve(null);
  await operation;
  expect(f.cm.state.doc.toString()).toContain("annotation=PUPR5FG5");
  expect(f.notify).toHaveBeenCalledTimes(1);
});
