// The workspace as a capability tag: layout readiness, the active file and
// editor, and the menu hooks ZotLit uses, without the Obsidian `App`. It copies
// the shape of ./obsidian-metadata-cache; policies/events.md (Capability tags)
// describes it. Views, leaves, `Component`s and React handlers stay edges and
// keep `app.workspace`.
import { MarkdownView } from "obsidian";
import type {
  Editor,
  MarkdownFileInfo,
  Menu,
  TAbstractFile,
  TFile,
  Workspace as ObsidianWorkspace,
  WorkspaceLeaf,
} from "obsidian";

import { Cause, Context, Effect, Layer, SubscriptionRef } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { ObsidianApp } from "@/lib/obsidian-app";
import { obsidianListener } from "@/lib/obsidian-event-source";
import type { ObsidianEventEmitter } from "@/lib/obsidian-event-source";

/** The Obsidian object the tag reads: what `app.workspace` gives. */
export type WorkspaceSource = Pick<
  ObsidianWorkspace,
  "onLayoutReady" | "getActiveFile" | "getActiveViewOfType"
> &
  ObsidianEventEmitter;

/** Where a file menu opened: Obsidian's `source` name, and the leaf of a view's own menu. */
export interface FileMenuOrigin {
  /** Such as `file-explorer-context-menu`, `more-options`, `tab-header`. */
  readonly source: string;
  readonly leaf: WorkspaceLeaf | undefined;
}

export interface WorkspaceShape {
  /**
   * Completes once the layout is ready: at once when it already is, else
   * inside Obsidian's layout-ready callback. It reads `onLayoutReady`, which
   * has no unregister, so a wait that is interrupted leaves Obsidian's
   * callback in place, inert.
   */
  readonly layoutReady: Effect.Effect<void>;
  /**
   * The active file: Obsidian's `getActiveFile()` when the layer builds, then
   * the file of each `file-open`. Its `changes` replay the current value.
   */
  readonly activeFile: SubscriptionRef.SubscriptionRef<TFile | null>;
  /** The Markdown view of the active leaf now, `null` when it holds none. */
  readonly activeMarkdownView: Effect.Effect<MarkdownView | null>;
  /**
   * Add `handler` to Obsidian's `file-menu` for the life of the current
   * Scope. Obsidian reads the menu as soon as its listeners return, so the
   * handler runs synchronously inside Obsidian's callback, with the context of
   * the caller. It must not suspend; only an entry's `onClick` may wait. A
   * failure is logged and the menu shows without the handler's remaining
   * entries.
   */
  onFileMenu<R = never>(
    handler: (
      menu: Menu,
      file: TAbstractFile,
      origin: FileMenuOrigin,
    ) => Effect.Effect<void, never, R>,
  ): Effect.Effect<void, never, R | Scope.Scope>;
  /** As {@link onFileMenu}, for Obsidian's `editor-menu`. */
  onEditorMenu<R = never>(
    handler: (
      menu: Menu,
      editor: Editor,
      info: MarkdownView | MarkdownFileInfo,
    ) => Effect.Effect<void, never, R>,
  ): Effect.Effect<void, never, R | Scope.Scope>;
}

/** The app's workspace. */
export class Workspace extends Context.Service<Workspace, WorkspaceShape>()(
  "zotlit/obsidian/Workspace",
) {}

/** The workspace service over `source`, for the life of the Scope. */
export const makeWorkspace = Effect.fnUntraced(function* (
  source: WorkspaceSource,
) {
  const activeFile = yield* SubscriptionRef.make(source.getActiveFile());
  yield* obsidianListener(source, "file-open", (file) => {
    Effect.runSync(SubscriptionRef.set(activeFile, file as TFile | null));
  });

  /** Register `name` on the current Scope; each call runs `toEffect` synchronously with the caller's context. */
  const menuHook = <R>(
    name: string,
    toEffect: (args: unknown[]) => Effect.Effect<void, never, R>,
  ) =>
    Effect.gen(function* () {
      const run = Effect.runSyncWith(yield* Effect.context<R>());
      yield* obsidianListener(source, name, (...args) => {
        run(
          toEffect(args).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Menu handler failed").pipe(
                Effect.annotateLogs({ menu: name, error: Cause.squash(cause) }),
                withLogCategory("workspace"),
              ),
            ),
          ),
        );
      });
    });

  return Workspace.of({
    layoutReady: Effect.callback<void>((resume) => {
      source.onLayoutReady(() => resume(Effect.void));
    }),
    activeFile,
    activeMarkdownView: Effect.sync(() =>
      source.getActiveViewOfType(MarkdownView),
    ),
    onFileMenu: (handler) =>
      menuHook("file-menu", ([menu, file, from, leaf]) =>
        handler(menu as Menu, file as TAbstractFile, {
          source: from as string,
          leaf: leaf as WorkspaceLeaf | undefined,
        }),
      ),
    onEditorMenu: (handler) =>
      menuHook("editor-menu", ([menu, editor, info]) =>
        handler(
          menu as Menu,
          editor as Editor,
          info as MarkdownView | MarkdownFileInfo,
        ),
      ),
  });
});

/** The tag over any object of the workspace's shape, such as a test host's. */
export const layerWorkspaceFrom = (
  source: WorkspaceSource,
): Layer.Layer<Workspace> => Layer.effect(Workspace, makeWorkspace(source));

/** The tag over the app's workspace. */
export const layerWorkspace: Layer.Layer<Workspace, never, ObsidianApp> =
  Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return yield* makeWorkspace(app.workspace);
    }),
  );
