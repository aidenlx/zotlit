import { history, undo } from "@codemirror/commands";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, FiberSet, Scope } from "effect";
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
import { openScope } from "@/lib/effect-scope";
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

/**
 * A runner over a Scope the test closes, as the view's runner is over the
 * view's lifetime, and the inserts it ran: each one's controlled render and
 * whether it was interrupted.
 */
function insertRunner() {
  const resource = openScope();
  const run = Effect.runSync(
    FiberSet.makeRuntime<never>().pipe(Scope.provide(resource.scope)),
  );
  const pending: ReturnType<typeof Promise.withResolvers<Result>>[] = [];
  const interrupted: boolean[] = [];
  const execute = vi.fn((input: AnnotationInsertRequest) =>
    Effect.suspend(() => {
      const index = pending.length;
      const request = Promise.withResolvers<Result>();
      pending.push(request);
      interrupted.push(false);
      void request.promise.catch(() => {});
      return annotationAction(
        input,
        Effect.tryPromise({
          try: () => request.promise,
          catch: (error) => templateFailure(error),
        }),
      ).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted[index] = true;
          }),
        ),
      );
    }),
  );
  return { run, execute, pending, interrupted, close: resource.close };
}

/** The outcome an insert answered, or `"interrupted"` when it was stopped. */
async function outcomeOf(
  fiber: Fiber.Fiber<AnnotationInsertOutcome>,
): Promise<AnnotationInsertOutcome | "interrupted"> {
  const exit = await Effect.runPromise(Fiber.await(fiber));
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return "interrupted";
  throw Cause.squash(exit.cause);
}
function fixture() {
  const runner = insertRunner();
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
  const { pending, interrupted } = runner;
  const prepare = runner.execute;
  const notify = vi.fn();
  const insert = createInsertHandler({
    app: stubService<App>("App", { workspace }),
    execute: prepare,
    run: runner.run,
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
    interrupted,
    notify,
    unload: runner.close,
    changed,
    async [Symbol.asyncDispose]() {
      await runner.close();
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
      expect(await outcomeOf(operation)).toEqual({
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
    expect(await outcomeOf(f.insert(card))).toEqual({ kind: "no-note" });
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
      expect(offered!(card)).toBeNull();
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
    expect(await outcomeOf(operation)).toMatchObject({
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
      expect(await outcomeOf(operation)).toEqual({ kind: "failed" });
      expect(f.notify).toHaveBeenCalledExactlyOnceWith(
        m.annot_view_insert_failed(),
      );
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);

it.effect(
  "reports a failed insert where the insert fails outside its outcome",
  () =>
    Effect.promise(async () => {
      await using f = fixture();
      f.prepare.mockImplementationOnce(() =>
        Effect.die(new Error("database closed")),
      );
      expect(await outcomeOf(f.insert(card))).toEqual({ kind: "failed" });
      expect(f.notify).toHaveBeenCalledExactlyOnceWith(
        m.annot_view_insert_failed(),
      );
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);

it.effect("stays silent and inserts nothing when unload ends the insert", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const operation = f.insert(card);
    await f.unload();
    expect(await outcomeOf(operation)).toBe("interrupted");
    expect(f.interrupted).toEqual([true]);
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.cm.state.doc.toString()).toBe("one two");
  }),
);

it.effect("supersedes the pending action and inserts once with one undo", () =>
  Effect.promise(async () => {
    await using f = fixture();
    const first = f.insert(card);
    const second = f.insert(card);
    await vi.waitFor(() => expect(f.interrupted[0]).toBe(true));
    f.cm.dispatch({ changes: { from: 0, insert: "user " } });
    f.pending[1]!.resolve(result("EXCERPT"));
    expect(await outcomeOf(second)).toMatchObject({ kind: "inserted" });
    f.pending[0]!.resolve(result("STALE"));
    expect(await outcomeOf(first)).toBe("interrupted");
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
      expect(await outcomeOf(operation)).toEqual(
        mode === "close" ? { kind: "cancelled" } : "interrupted",
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
    expect(await outcomeOf(operation)).toEqual({
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
  const runner = insertRunner();
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
  const { pending, interrupted } = runner;
  const dragNotify = vi.fn();
  const prepare = vi.fn((input: AnnotationInsertRequest) => {
    preparing = true;
    return runner.execute(input);
  });
  const handler = createDragInsertHandler({
    app: stubService<App>("App", { workspace }),
    execute: prepare,
    run: runner.run,
    notify: dragNotify,
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
    interrupted,
    notify: dragNotify,
    unload: runner.close,
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
      await runner.close();
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
      if (mode === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      if (mode === "overlap")
        f.cm.dispatch({ changes: { from: 4, insert: "user" } });
      if (mode === "close") {
        f.cm.dom.remove();
        f.emit("layout-change");
      }
      if (mode === "new-drag") f.start();
      await vi.waitFor(() => expect(f.interrupted[0]).toBe(true));
      f.pending[0]!.resolve(result("LATE"));
      if (mode === "new-drag") window.dispatchEvent(new DragEvent("dragend"));
      await f.cleaned;
      expect(f.listenerCount()).toBe(0);
      expect(f.cm.state.doc.toString()).not.toContain("LATE");
    }),
);

it.effect(
  "stops a dropped insert quietly when the annotation view closes",
  () =>
    Effect.promise(async () => {
      await using f = dragFixture();
      vi.spyOn(f.cm, "posAtCoords").mockReturnValue(4);
      const drag = f.start();
      f.drop(drag.dataTransfer);
      expect(f.prepare).toHaveBeenCalledOnce();
      await f.unload();
      expect(f.interrupted).toEqual([true]);
      f.pending[0]!.resolve(result("LATE"));
      await f.cleaned;
      expect(f.listenerCount()).toBe(0);
      expect(f.notify).not.toHaveBeenCalled();
      expect(f.cm.state.doc.toString()).toBe("one two");
    }),
);
