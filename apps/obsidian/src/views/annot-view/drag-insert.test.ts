import { history, undo } from "@codemirror/commands";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
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
import { expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge, valueOr } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { annotationAction } from "@/services/note-feature/__fixtures__/annotation-actions";
import type { AnnotationInsertRequest } from "@/services/note-feature/insert-action";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation";
import {
  templateFailure,
  ProfileAnnotationError,
} from "@/services/template/service";

import { stateEditor } from "./__fixtures__/editor";
import {
  createDragInsertHandler,
  createInsertHandler,
  insertOutcomeMessage,
} from "./drag-insert";
import type { AnnotationInsertOutcome } from "./drag-insert";

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
type Result = AnnotationInsert;
function fixture() {
  const stack = new AsyncDisposableStack();
  const bridge = effectBridge(buildRuntime(Layer.empty, stack));
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
  const prepare = vi.fn(
    (input: AnnotationInsertRequest, signal: AbortSignal) => {
      const request = Promise.withResolvers<Result>();
      pending.push(request);
      void request.promise.catch(() => {});
      return bridge
        .runPromiseExit(
          annotationAction(
            input,
            Effect.tryPromise({
              try: (signal) => {
                signal.throwIfAborted();
                return request.promise;
              },
              catch: (error) => templateFailure(error),
            }),
          ),
          { signal },
        )
        .then((exit) => valueOr(exit, undefined));
    },
  );
  const notify = vi.fn();
  const insert = createInsertHandler({
    app: stubService<App>("App", { workspace }),
    execute: prepare,
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
    insert,
    pending,
    notify,
    unload: () => stack.disposeAsync(),
    changed,
    async [Symbol.asyncDispose]() {
      await stack.disposeAsync();
      insert.cancel();
      cm.destroy();
    },
  };
}
const result = (text: string): Result => ({
  text,
  summary: { zotero: 0, unchecked: 0, unavailable: 0 },
});

it.effect(
  "inserts at the note's selection after the annotation sidebar takes focus",
  () =>
    Effect.promise(async () => {
      await using f = fixture();
      f.workspace.activeEditor = null;
      const operation = f.insert(card);
      expect(f.prepare).toHaveBeenCalledOnce();
      f.pending[0]!.resolve(result("EXCERPT"));
      expect(await operation).toEqual({
        kind: "inserted",
        summary: { zotero: 0, unchecked: 0, unavailable: 0 },
      });
      expect(f.cm.state.doc.toString()).toBe("one EXCERPT ");
    }),
);

it.effect("offers no insert into a note in Reading view", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
    const reading = Object.assign(new MarkdownView(leaf), f.info, {
      getMode: () => "preview",
    });
    leaf.view = reading;
    f.workspace.activeEditor = reading;
    f.workspace.getMostRecentLeaf = () => leaf;

    expect(f.insert.offer()).toBeNull();
    expect(await f.insert(card)).toEqual({ kind: "no-note" });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.cm.state.doc.toString()).toBe("one two");
  }),
);

it.effect(
  "keeps a menu offer bound to its note if another tab becomes active",
  () =>
    Effect.promise(async () => {
      await using f = fixture();
      const offered = f.insert.offer();
      expect(offered).not.toBeNull();
      const file = new TFile();
      file.path = "Other.md";
      f.workspace.activeEditor = stubService<MarkdownFileInfo>(
        "MarkdownFileInfo",
        {
          file,
          editor: stubService<Editor>("Editor", {}),
        },
      );
      await offered!(card);
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);

it.effect("keeps the established text fallback for a Profile error", () =>
  Effect.promise(async () => {
    await using f = fixture();
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
    expect(await operation).toMatchObject({
      kind: "profile-error",
      landed: true,
    });
    expect(f.cm.state.doc.toString()).toBe("one Original highlight ");
  }),
);

it.effect(
  "leaves the note unchanged, and the error to the log, where the insertion fails",
  () =>
    Effect.promise(async () => {
      await using f = fixture();
      const operation = f.insert(card);
      f.pending[0]!.reject(new Error("private failure detail"));
      expect(await operation).toEqual({ kind: "failed" });
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);

it.effect("stays silent and inserts nothing when unload ends the insert", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const operation = f.insert(card);
    await f.unload();
    expect(await operation).toBeUndefined();
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.cm.state.doc.toString()).toBe("one two");
  }),
);

it.effect("supersedes the pending action and inserts once with one undo", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const first = f.insert(card);
    const second = f.insert(card);
    expect(f.prepare.mock.calls[0]?.[1].aborted).toBe(true);
    f.cm.dispatch({ changes: { from: 0, insert: "user " } });
    f.pending[1]!.resolve(result("EXCERPT"));
    expect(await second).toMatchObject({ kind: "inserted" });
    f.pending[0]!.resolve(result("STALE"));
    expect(await first).toBeUndefined();
    expect(f.cm.state.doc.toString()).toBe("user one EXCERPT ");
    undo(f.cm);
    expect(f.cm.state.doc.toString()).toBe("user one two");
  }),
);
it.effect.each(["switch", "close", "cancel"])(
  "cancels the action after target %s",
  (mode) =>
    Effect.promise(async () => {
      await using f = fixture();
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
      expect(await operation).toEqual(
        mode === "close" ? { kind: "cancelled" } : undefined,
      );
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);
it.effect("inserts an unavailable-image result", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const operation = f.insert(card);
    f.pending[0]!.resolve({
      text: "Image unavailable [Zotero](zotero://open)",
      summary: { zotero: 0, unchecked: 0, unavailable: 1 },
    });
    expect(await operation).toEqual({
      kind: "inserted",
      summary: { zotero: 0, unchecked: 0, unavailable: 1 },
    });
    expect(f.cm.state.doc.toString()).toBe(
      "one Image unavailable [Zotero](zotero://open) ",
    );
  }),
);

it.each([
  [{ kind: "no-note" }, m.annot_view_insert_no_note()],
  [{ kind: "source-unavailable" }, m.annot_view_drag_unavailable()],
  [{ kind: "fallback", landed: true }, m.annot_view_drag_unavailable()],
  [{ kind: "fallback", landed: false }, null],
  [
    {
      kind: "inserted",
      summary: { zotero: 0, unchecked: 0, unavailable: 1 },
    },
    m.excerpt_image_summary({
      zotero: 0,
      unchecked: 0,
      unavailable: 1,
      notRefreshed: 0,
    }),
  ],
  [
    { kind: "inserted", summary: { zotero: 0, unchecked: 0, unavailable: 0 } },
    null,
  ],
  // The error's own detail stays in the log.
  [{ kind: "failed" }, m.annot_view_insert_failed()],
  [{ kind: "cancelled" }, null],
] satisfies [AnnotationInsertOutcome, string | null][])(
  "reports %o with its notice",
  (outcome, message) => {
    expect(insertOutcomeMessage(stubService<App>("App", {}), outcome)).toBe(
      message,
    );
  },
);

function dragFixture() {
  const stack = new AsyncDisposableStack();
  const bridge = effectBridge(buildRuntime(Layer.empty, stack));
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
  const prepare = vi.fn(
    (input: AnnotationInsertRequest, signal: AbortSignal) => {
      preparing = true;
      const request = Promise.withResolvers<Result>();
      pending.push(request);
      void request.promise.catch(() => {});
      return bridge
        .runPromiseExit(
          annotationAction(
            input,
            Effect.tryPromise({
              try: (signal) => {
                signal.throwIfAborted();
                return request.promise;
              },
              catch: (error) => templateFailure(error),
            }),
          ),
          { signal },
        )
        .then((exit) => valueOr(exit, undefined));
    },
  );
  const handler = createDragInsertHandler({
    app: stubService<App>("App", { workspace }),
    execute: prepare,
    notify: () => undefined,
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
    start,
    drop,
    emit,
    handler,
    async [Symbol.asyncDispose]() {
      await stack.disposeAsync();
      handler.cancel();
      cm.destroy();
      source.remove();
    },
  };
}

it.effect(
  "captures the tagged drop coordinates, maps later edits, and undoes once",
  () =>
    Effect.promise(async () => {
      await using f = dragFixture();
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
    }),
);

it.effect(
  "inserts where CodeMirror's own drop would when no exact position is under the pointer",
  () =>
    Effect.promise(async () => {
      await using f = dragFixture();
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
    }),
);

it.effect(
  "leaves unrelated editor drops native while a ZotLit drag is active",
  () =>
    Effect.promise(async () => {
      await using f = dragFixture();
      vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
      f.start();
      const native = new DataTransfer();
      native.setData("text/plain", "native");
      const dropped = f.drop(native);
      expect(dropped.defaultPrevented).toBe(false);
      expect(f.prepare).not.toHaveBeenCalled();
      window.dispatchEvent(new DragEvent("dragend"));
    }),
);

it.effect("does no preparation for an abandoned drag", () =>
  Effect.promise(async () => {
    await using f = dragFixture();
    f.start();
    window.dispatchEvent(new DragEvent("dragend"));
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.cm.state.doc.toString()).toBe("one two");
  }),
);

it.effect.each(["escape", "overlap", "close", "new-drag"])(
  "cancels a pending tagged drop after %s",
  (mode) =>
    Effect.promise(async () => {
      await using f = dragFixture();
      vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
      const first = f.start();
      f.drop(first.dataTransfer);
      const signal = f.prepare.mock.calls[0]![1];
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
    }),
);
