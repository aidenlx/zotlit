// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import { MarkdownView } from "obsidian";
import { TFile } from "obsidian";
import type {
  App,
  Editor,
  EventRef,
  MarkdownFileInfo,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import type { DragEvent as ReactDragEvent } from "react";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { NoteFeatureHandle } from "@/services/note-feature";
import { ProfileAnnotationError } from "@/services/template/service";

import { stateEditor } from "./__fixtures__/editor";
import { createDragInsertHandler, createInsertHandler } from "./drag-insert";

const card: AnnotationRecord = {
  key: "PUPR5FG5",
  parentKey: "RGRPDF24",
  type: "image",
  color: null,
  text: null,
  comment: null,
  pageLabel: "1",
  sortIndex: "00000|000000|00000",
  tags: [],
  version: 2,
  lock: null,
  position: { kind: "pdf-rects", pageIndex: 0, rects: [[1, 2, 3, 4]] },
};
type Result = Awaited<ReturnType<NoteFeatureHandle["prepareAnnotationInsert"]>>;
function fixture() {
  const cm = stateEditor({
    doc: "one two",
    selection: { anchor: 4, head: 7 },
    extensions: [history()],
  });
  const file = new TFile();
  file.path = "Target.md";
  const editor = stubService<Editor>("Editor", { cm });
  const info = stubService<MarkdownFileInfo>("MarkdownFileInfo", {
    file,
    editor,
  });
  let activeEditor: MarkdownFileInfo | null = info;
  const listeners = new Map<string, Set<EventRef>>();
  const refs = new Map<
    EventRef,
    { name: string; callback: (...args: never[]) => unknown }
  >();
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  const view = new MarkdownView(leaf);
  Object.assign(view, info, { getMode: () => "source" });
  leaf.view = view;
  const workspace = stubService<Workspace>("Workspace", {
    get activeEditor() {
      return activeEditor;
    },
    set activeEditor(value) {
      activeEditor = value;
    },
    getMostRecentLeaf: () => leaf,
    on: (
      name: string,
      callback: (...args: never[]) => unknown,
      _ctx?: unknown,
    ) => {
      const callbacks = listeners.get(name) ?? new Set();
      const ref = stubService<EventRef>("EventRef", {});
      callbacks.add(ref);
      listeners.set(name, callbacks);
      refs.set(ref, { name, callback });
      return ref;
    },
    offref: (ref: EventRef) => {
      const entry = refs.get(ref);
      if (!entry) return;
      listeners.get(entry.name)?.delete(ref);
      refs.delete(ref);
    },
  });
  const changed = () => {
    for (const ref of listeners.get("active-leaf-change") ?? []) {
      const callback = refs.get(ref);
      if (callback) callback.callback();
    }
  };
  const pending: ReturnType<typeof Promise.withResolvers<Result>>[] = [];
  const prepare = vi.fn<NoteFeatureHandle["prepareAnnotationInsert"]>(() => {
    const request = Promise.withResolvers<Result>();
    pending.push(request);
    return request.promise;
  });
  const notify = vi.fn();
  const insert = createInsertHandler({
    app: stubService<App>("App", { workspace }),
    noteFeature: stubService<
      Pick<NoteFeatureHandle, "prepareAnnotationInsert">
    >("NoteFeatureHandle", {
      prepareAnnotationInsert: prepare,
    }),
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
    changed,
    [Symbol.dispose]() {
      insert.cancel();
      cm.destroy();
    },
  };
}
const result = (text: string): Result => ({
  text,
  summary: { zotero: 0, unchecked: 0, unavailable: 0 },
});

it("inserts at the note's selection after the annotation sidebar takes focus", async () => {
  using f = fixture();
  f.workspace.activeEditor = null;
  const operation = f.insert(card);
  expect(f.prepare).toHaveBeenCalledOnce();
  f.pending[0]!.resolve(result("EXCERPT"));
  await operation;
  expect(f.cm.state.doc.toString()).toBe("one EXCERPT ");
  expect(f.notify).not.toHaveBeenCalled();
});

it("offers no insert into a note in Reading view, and says to open one", async () => {
  using f = fixture();
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  const reading = Object.assign(new MarkdownView(leaf), f.info, {
    getMode: () => "preview",
  });
  leaf.view = reading;
  f.workspace.activeEditor = reading;
  f.workspace.getMostRecentLeaf = () => leaf;

  expect(f.insert.offer()).toBeNull();
  await f.insert(card);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.cm.state.doc.toString()).toBe("one two");
  expect(f.notify).toHaveBeenCalledWith(m.annot_view_insert_no_note());
});

it("keeps a menu offer bound to its note if another tab becomes active", async () => {
  using f = fixture();
  const offered = f.insert.offer();
  expect(offered).not.toBeNull();
  const file = new TFile();
  file.path = "Other.md";
  f.workspace.activeEditor = stubService<MarkdownFileInfo>("MarkdownFileInfo", {
    file,
    editor: stubService<Editor>("Editor", {}),
  });
  await offered!(card);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.cm.state.doc.toString()).toBe("one two");
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
  expect(f.cm.state.doc.toString()).toBe("one Original highlight ");
  expect(f.notify).toHaveBeenCalledTimes(1);
});

it("keeps internal insertion errors out of the notice", async () => {
  using f = fixture();
  const operation = f.insert(card);
  f.pending[0]!.reject(new Error("private failure detail"));
  await operation;
  expect(f.notify).toHaveBeenCalledWith(m.annot_view_insert_failed());
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
  expect(f.cm.state.doc.toString()).toBe("user one EXCERPT ");
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
      const file = new TFile();
      file.path = "Other.md";
      f.workspace.activeEditor = stubService<MarkdownFileInfo>(
        "MarkdownFileInfo",
        {
          file,
          editor: stubService<Editor>("Editor", {}),
        },
      );
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
    "one Image unavailable [Zotero](zotero://open) ",
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

function dragFixture() {
  const cm = stateEditor({ doc: "one two", extensions: [history()] });
  const file = new TFile();
  file.path = "Drop.md";
  const editor = stubService<Editor>("Editor", { cm });
  const info = stubService<MarkdownFileInfo>("MarkdownFileInfo", {
    file,
    editor,
  });
  const listeners = new Map<string, Set<EventRef>>();
  const refs = new Map<
    EventRef,
    { name: string; callback: (...args: never[]) => unknown }
  >();
  let preparing = false;
  const cleaned = Promise.withResolvers<void>();
  const allListenersRemoved = () =>
    [...listeners.values()].every((callbacks) => callbacks.size === 0);
  const workspace = stubService<Workspace>("Workspace", {
    on: (
      name: string,
      callback: (...args: never[]) => unknown,
      _ctx?: unknown,
    ) => {
      const callbacks = listeners.get(name) ?? new Set();
      const ref = stubService<EventRef>("EventRef", {});
      callbacks.add(ref);
      listeners.set(name, callbacks);
      refs.set(ref, { name, callback });
      return ref;
    },
    offref: (ref: EventRef) => {
      const entry = refs.get(ref);
      if (!entry) return;
      listeners.get(entry.name)?.delete(ref);
      refs.delete(ref);
      if (preparing && allListenersRemoved()) cleaned.resolve();
    },
  });
  const emit = (event: string, ...args: unknown[]) => {
    for (const ref of listeners.get(event) ?? []) {
      const callback = refs.get(ref);
      if (callback) callback.callback(...(args as never[]));
    }
  };
  const pending: ReturnType<typeof Promise.withResolvers<Result>>[] = [];
  const prepare = vi.fn<NoteFeatureHandle["prepareAnnotationInsert"]>(() => {
    preparing = true;
    const request = Promise.withResolvers<Result>();
    pending.push(request);
    return request.promise;
  });
  const notify = vi.fn();
  const handler = createDragInsertHandler({
    app: stubService<App>("App", { workspace }),
    noteFeature: stubService<
      Pick<NoteFeatureHandle, "prepareAnnotationInsert">
    >("NoteFeatureHandle", {
      prepareAnnotationInsert: prepare,
    }),
    notify,
    snapshot: () => ({
      source: { kind: "zotero-local-api", serverID: "SERVER000001" },
      sourceScope: "/zotero",
    }),
  });
  const source = document.createElement("button");
  Object.defineProperty(source, "win", { value: window });
  document.body.append(source);
  const start = (annotation = card) => {
    const dataTransfer = new DataTransfer();
    const preventDefault = vi.fn();
    handler(
      {
        currentTarget: source,
        dataTransfer,
        preventDefault,
      } as unknown as ReactDragEvent<HTMLElement>,
      annotation,
    );
    return { dataTransfer, preventDefault };
  };
  const drop = (dataTransfer: DataTransfer, x = 11, y = 17) => {
    let defaultPrevented = false;
    const event = {
      clientX: x,
      clientY: y,
      dataTransfer,
      get defaultPrevented() {
        return defaultPrevented;
      },
      preventDefault() {
        defaultPrevented = true;
      },
    } as unknown as DragEvent;
    emit("editor-drop", event, editor, info);
    return event;
  };
  return {
    cm,
    info,
    source,
    prepare,
    pending,
    cleaned: cleaned.promise,
    listenerCount: () =>
      [...listeners.values()].reduce(
        (count, callbacks) => count + callbacks.size,
        0,
      ),
    notify,
    start,
    drop,
    emit,
    handler,
    [Symbol.dispose]() {
      handler.cancel();
      cm.destroy();
      source.remove();
    },
  };
}

it("captures the tagged drop coordinates, maps later edits, and undoes once", async () => {
  using f = dragFixture();
  const position = vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
  const drag = f.start();
  const dropped = f.drop(drag.dataTransfer, 23, 29);
  expect(dropped.defaultPrevented).toBe(true);
  expect(position).toHaveBeenCalledWith({ x: 23, y: 29 }, false);
  expect(f.prepare).toHaveBeenCalledOnce();
  f.cm.dispatch({ changes: { from: 0, insert: "user " } });
  f.cm.dispatch({ selection: { anchor: f.cm.state.doc.length } });
  f.pending[0]!.resolve(result("EXCERPT"));
  await vi.waitFor(() =>
    expect(f.cm.state.doc.toString()).toBe("user one EXCERPT two"),
  );
  expect(undo(f.cm)).toBe(true);
  expect(f.cm.state.doc.toString()).toBe("user one two");
});

it("inserts where CodeMirror's own drop would when no exact position is under the pointer", async () => {
  using f = dragFixture();
  // An empty active last line has no exact position under the pointer; the
  // nearest one still exists.
  vi.spyOn(f.cm, "posAtCoords").mockImplementation((_, precise = true) =>
    precise ? null : 4,
  );
  const drag = f.start();
  f.drop(drag.dataTransfer);
  expect(f.prepare).toHaveBeenCalledOnce();
  f.pending[0]!.resolve(result("EXCERPT"));
  await vi.waitFor(() =>
    expect(f.cm.state.doc.toString()).toBe("one EXCERPT two"),
  );
  expect(f.notify).not.toHaveBeenCalled();
});

it("leaves unrelated editor drops native while a ZotLit drag is active", () => {
  using f = dragFixture();
  vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
  f.start();
  const native = new DataTransfer();
  native.setData("text/plain", "native");
  const dropped = f.drop(native);
  expect(dropped.defaultPrevented).toBe(false);
  expect(f.prepare).not.toHaveBeenCalled();
  window.dispatchEvent(new DragEvent("dragend"));
});

it("does no preparation for an abandoned drag", () => {
  using f = dragFixture();
  f.start();
  window.dispatchEvent(new DragEvent("dragend"));
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.cm.state.doc.toString()).toBe("one two");
});

it.each(["escape", "overlap", "close", "new-drag"])(
  "cancels a pending tagged drop after %s",
  async (mode) => {
    using f = dragFixture();
    vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
    const first = f.start();
    f.drop(first.dataTransfer);
    const signal = f.prepare.mock.calls[0]![0].signal;
    if (mode === "escape")
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    if (mode === "overlap")
      f.cm.dispatch({ changes: { from: 4, insert: "user" } });
    if (mode === "close") {
      f.cm.dom.remove();
      f.emit("layout-change");
    }
    if (mode === "new-drag") f.start();
    expect(signal.aborted).toBe(true);
    f.pending[0]!.resolve(result("LATE"));
    if (mode === "new-drag") window.dispatchEvent(new DragEvent("dragend"));
    await f.cleaned;
    expect(f.listenerCount()).toBe(0);
    expect(f.cm.state.doc.toString()).not.toContain("LATE");
  },
);
