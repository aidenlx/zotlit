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
import { MarkdownView, TFile } from "obsidian";
import type {
  Editor,
  Workspace as WorkspaceApi,
  WorkspaceLeaf,
} from "obsidian";
import { expect } from "vitest";

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
              workspace: source as unknown as WorkspaceApi,
            }),
          ),
        ),
      ),
    );
    expect((yield* workspace.getActiveFile)?.path).toBe("a.md");
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

it.effect("owns the file-open listener until the layer closes", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { scope } = yield* open(layerWorkspaceFrom(source));
    expect(source.listenerCount("file-open")).toBe(1);
    yield* Scope.close(scope, Exit.void);
    expect(source.listenerCount("file-open")).toBe(0);
  }),
);

it.effect("reads the active Markdown view", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    expect(yield* workspace.activeMarkdownView).toBeNull();
    const view = new MarkdownView({} as WorkspaceLeaf);
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
    const view = new MarkdownView({} as WorkspaceLeaf);
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
    const editor = { getValue: () => "text" } as unknown as Editor;
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

it.effect("streams each file-open from when the consumer starts", () =>
  Effect.gen(function* () {
    const source = new MemoryWorkspace();
    source.activeFile = file("a.md");
    const { workspace } = yield* open(layerWorkspaceFrom(source));
    const opened = yield* workspace.changes.pipe(
      Stream.map((event) => `${event._tag} ${event.file?.path ?? null}`),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true }),
    );
    source.open(file("b.md"));
    source.open(null);
    expect(yield* Fiber.join(opened)).toEqual([
      "file-open b.md",
      "file-open null",
    ]);
  }),
);
