import { it } from "@effect/vitest";
import { Menu } from "@mock/obsidian";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Scope,
  Stream,
} from "effect";
import { MarkdownView, TextFileView, TFile } from "obsidian";
import type {
  Editor,
  Workspace as WorkspaceApi,
  WorkspaceLeaf,
} from "obsidian";
import { expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  layerWorkspace,
  layerWorkspaceFrom,
  Workspace,
} from "@/lib/obsidian-workspace";

import { MemoryWorkspace } from "./__fixtures__/obsidian-workspace";

function file(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

/** A text view that holds its text in `data`. */
class MemoryTextView extends TextFileView {
  override getViewData(): string {
    return this.data;
  }
  override setViewData(data: string): void {
    this.data = data;
  }
  override clear(): void {
    this.data = "";
  }
  override getViewType(): string {
    return "markdown";
  }
}

/** The layer built on a Scope of its own, closed with the case's Scope. */
const open = Effect.fnUntraced(function* (layer: Layer.Layer<Workspace>) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const context = yield* Layer.buildWithScope(layer, scope);
  return { scope, workspace: Context.get(context, Workspace) };
});

it.effect("reads the live layer's workspace from ObsidianApp", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    source.activeFile = file("a.md");
    const { workspace } = yield* open(
      layerWorkspace.pipe(
        Layer.provide(
          Layer.succeed(
            ObsidianApp,
            stubService<ObsidianApp["Service"]>("ObsidianApp", {
              workspace: stubService<WorkspaceApi>("Workspace", {
                getActiveFile: () => source.getActiveFile(),
                on: vi.fn(() => ({})),
                offref: vi.fn(),
              }),
            }),
          ),
        ),
      ),
    );
    expect((yield* workspace.getActiveFile)?.path).toBe("a.md");
  }),
);

it.effect("finds the loaded text view of a file in any leaf", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const textView = (path: string, lastSavedData: string | null) => {
      const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        updateHeader() {},
      });
      // The text view reads its App from the leaf.
      Object.defineProperty(leaf, "app", { value: {} });
      const view = Object.assign(new MemoryTextView(leaf), {
        file: file(path),
        data: "edited",
        lastSavedData,
      });
      source.openLeaf("markdown", view);
      return view;
    };
    const loaded = textView("a.md", "saved");
    // A view whose text has not loaded yet does not count.
    const unloaded = textView("b.md", null);
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    expect(yield* workspace.loadedTextView(loaded.file)).toBe(loaded);
    expect(yield* workspace.loadedTextView(unloaded.file)).toBeNull();
    expect(yield* workspace.loadedTextView(file("c.md"))).toBeNull();
  }),
);

it.effect("fails openLinkText with OpenLinkFailed when Obsidian rejects", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const error = new Error("No leaf");
    source.openLinkText = () => Promise.reject(error);
    const { workspace } = yield* open(layerWorkspaceFrom(source));

    const failure = yield* Effect.flip(workspace.openLinkText("a.md", ""));

    expect(failure).toMatchObject({
      _tag: "OpenLinkFailed",
      linktext: "a.md",
      message: "No leaf",
      cause: error,
    });
  }),
);

it.effect("completes layoutReady at once when the layout is ready", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace({ layoutReady: true });
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const fiber = yield* workspace.layoutReady.pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    expect(fiber.pollUnsafe()).toEqual(Exit.void);
  }),
);

it.effect("completes layoutReady inside Obsidian's callback", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const fiber = yield* workspace.layoutReady.pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    expect(fiber.pollUnsafe()).toBeUndefined();
    source.layoutReady();
    expect(fiber.pollUnsafe()).toEqual(Exit.void);
    // A second wait after the layout is ready completes at once too.
    const again = yield* workspace.layoutReady.pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    expect(again.pollUnsafe()).toEqual(Exit.void);
  }),
);

it.effect("owns one listener per event name until the layer closes", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const names = ["file-open", "layout-change"];
    const { scope } = yield* open(layerWorkspaceFrom(source));
    expect(names.map((name) => source.listenerCount(name))).toEqual([1, 1]);
    yield* Scope.close(scope, Exit.void);
    expect(names.map((name) => source.listenerCount(name))).toEqual([0, 0]);
  }),
);

it.effect("reads the active Markdown view", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    expect(yield* workspace.activeMarkdownView).toBeNull();
    const view = new MarkdownView(
      stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
    );
    source.activeView = view;
    expect(yield* workspace.activeMarkdownView).toBe(view);
    source.activeView = {};
    expect(yield* workspace.activeMarkdownView).toBeNull();
  }),
);

it.effect(
  "fills the file menu inside Obsidian's callback, until the Scope closes",
  () =>
    Effect.gen(function* () {
      const source = new MemoryWorkspace();
      const { workspace } = yield* open(layerWorkspaceFrom(source));
      const menuScope = yield* Scope.fork(yield* Effect.scope);
      yield* workspace
        .onFileMenu((menu, target, { source: from }) =>
          Effect.sync(() => {
            menu.addItem((item) => item.setTitle(`${from}:${target.path}`));
          }),
        )
        .pipe(Scope.provide(menuScope));
      const menu = new Menu();
      source.trigger("file-menu", menu, file("a.md"), "more-options");
      expect(menu.items.map((item) => item.title)).toEqual([
        "more-options:a.md",
      ]);
      yield* Scope.close(menuScope, Exit.void);
      expect(source.listenerCount("file-menu")).toBe(0);
    }),
);

it.effect("fills the editor menu inside Obsidian's callback", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const view = new MarkdownView(
      stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
    );
    yield* workspace.onEditorMenu((menu, editor, info) =>
      Effect.sync(() => {
        menu.addItem((item) =>
          item.setTitle(
            `${editor.getValue()}:${info === view ? "view" : "other"}`,
          ),
        );
      }),
    );
    const menu = new Menu();
    const editor = stubService<Editor>("Editor", {
      getValue: () => "text",
    });
    source.trigger("editor-menu", menu, editor, view);
    expect(menu.items.map((item) => item.title)).toEqual(["text:view"]);
  }),
);

it.effect("logs a failed menu handler and keeps the menu", () =>
  Effect.gen(function* () {
    const logged: string[] = [];
    const capture = Logger.make(({ logLevel, message }) => {
      logged.push(`${logLevel}: ${String(message)}`);
    });
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    yield* workspace
      .onFileMenu(() => Effect.die(new Error("boom")))
      .pipe(Effect.provide(Logger.layer([capture])));
    const menu = new Menu();
    expect(() =>
      source.trigger("file-menu", menu, file("a.md"), "more-options"),
    ).not.toThrow();
    expect(logged).toEqual(["Error: Menu handler failed"]);
  }),
);

it.effect(
  "streams each file-open and layout-change from when the consumer starts",
  () =>
    Effect.gen(function* () {
      const source = new MemoryWorkspace();
      source.activeFile = file("a.md");
      const { workspace } = yield* open(layerWorkspaceFrom(source));
      const opened = yield* workspace.changes.pipe(
        Stream.map((event) =>
          event._tag === "file-open"
            ? `${event._tag} ${event.file?.path ?? null}`
            : event._tag,
        ),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      source.open(file("b.md"));
      source.trigger("layout-change");
      source.open(null);
      expect(yield* Fiber.join(opened)).toEqual([
        "file-open b.md",
        "layout-change",
        "file-open null",
      ]);
    }),
);

it.effect("delivers a deferred file-open on requestActiveLeafEvents", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    source.deferOpen(file("a.md"));
    expect(source.getActiveFile()).toBeNull();
    yield* workspace.requestActiveLeafEvents;
    expect(source.getActiveFile()?.path).toBe("a.md");
  }),
);

it.effect("streams each active-leaf-change and css-change", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
    const seen = yield* workspace.changes.pipe(
      Stream.map((event) =>
        event._tag === "active-leaf-change"
          ? `${event._tag} ${event.leaf === leaf}`
          : event._tag,
      ),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true }),
    );
    source.trigger("active-leaf-change", leaf);
    source.trigger("css-change");
    source.trigger("active-leaf-change", null);
    expect(yield* Fiber.join(seen)).toEqual([
      "active-leaf-change true",
      "css-change",
      "active-leaf-change false",
    ]);
  }),
);

it.effect("reads the open leaves of one view type", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const view = new MarkdownView(
      stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
    );
    const leaf = source.openLeaf("graph", view);
    expect(yield* workspace.leavesOfType("graph")).toEqual([leaf]);
    expect(yield* workspace.leavesOfType("localgraph")).toEqual([]);
  }),
);

it.effect(
  "reads the saved layout, and null where the build has no reader",
  () =>
    Effect.gen(function* () {
      const source = new MemoryWorkspace();
      source.savedLayout = { main: { id: "root" } };
      const { workspace } = yield* open(layerWorkspaceFrom(source));
      expect(yield* workspace.readWorkspaceFile).toEqual({
        main: { id: "root" },
      });
      const bare = new MemoryWorkspace();
      Object.assign(bare, { readWorkspaceFile: undefined });
      const { workspace: moved } = yield* open(layerWorkspaceFrom(bare));
      expect(yield* moved.readWorkspaceFile).toBeNull();
    }),
);
