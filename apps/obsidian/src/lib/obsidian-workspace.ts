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

import { Context, Effect, Layer, SubscriptionRef } from "@/lib/effect";
import type { Scope, Stream } from "@/lib/effect";
import { logAndContinue } from "@/lib/effect-log";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  obsidianEventSource,
  obsidianListener,
} from "@/lib/obsidian-event-source";
import type { ObsidianEventEmitter } from "@/lib/obsidian-event-source";

/** The Obsidian object the tag reads: what `app.workspace` gives. */
export type WorkspaceSource = Pick<
  ObsidianWorkspace,
  "onLayoutReady" | "getActiveFile" | "getActiveViewOfType"
> &
  ObsidianEventEmitter;

/** One workspace event, tagged with its Obsidian event name. */
export type WorkspaceEvent =
  /** The active file changed; `null` when no file is active. */
  { readonly _tag: "file-open"; readonly file: TFile | null };

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
  /** Each workspace event, in Obsidian's order, from when the consumer's Stream starts. */
  readonly changes: Stream.Stream<WorkspaceEvent>;
  /**
   * The active file: Obsidian's `getActiveFile()` when the layer builds, then
   * the file of each `file-open`. Its `changes` replay the current value.
   */
  readonly activeFile: SubscriptionRef.SubscriptionRef<TFile | null>;
  /** Obsidian's `getActiveFile()` now; `activeFile` can lag it, as Obsidian defers `file-open`. */
  readonly getActiveFile: Effect.Effect<TFile | null>;
  /** The Markdown view of the active leaf now, `null` when it holds none. */
  readonly activeMarkdownView: Effect.Effect<MarkdownView | null>;
  /**
   * Add `handler` to Obsidian's `file-menu` for the life of the current
   * Scope. Obsidian reads the menu as soon as its listeners return, so the
   * handler runs synchronously inside Obsidian's callback, with the context of
   * the caller. It must not suspend; only an entry's `onClick` may wait. A
   * failure is logged and the menu shows without the handler's remaining
   * entries.
   *
   * ZotLit keeps one `file-menu` listener (the obsidian-actions skill):
   * `services/file-menu.ts` registers its own today and must move onto this
   * hook, in place of that listener, when it converts.
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
  const events = yield* obsidianEventSource<WorkspaceEvent>();
  yield* events.listen(source, "file-open", (file: TFile | null) => ({
    _tag: "file-open",
    file,
  }));
  const activeFile = yield* SubscriptionRef.make(source.getActiveFile());
  // Hands each `file-open` over inside Obsidian's callback.
  yield* forkEach(filterTag(events.stream, "file-open"), ({ file }) =>
    SubscriptionRef.set(activeFile, file),
  );

  /** Register `name` on the current Scope; each call runs `toEffect` synchronously with the caller's context. */
  const menuHook = <Args extends unknown[], R>(
    name: string,
    toEffect: (...args: Args) => Effect.Effect<void, never, R>,
  ) =>
    Effect.gen(function* () {
      const run = Effect.runSyncWith(yield* Effect.context<R>());
      // Obsidian's base Events API erases event-specific argument types.
      yield* obsidianListener(source, name, (...args) => {
        run(
          toEffect(...(args as Args)).pipe(
            logAndContinue("Menu handler failed", "workspace", { menu: name }),
          ),
        );
      });
    });

  return Workspace.of({
    layoutReady: Effect.callback<void>((resume) => {
      source.onLayoutReady(() => resume(Effect.void));
    }),
    changes: events.stream,
    activeFile,
    getActiveFile: Effect.sync(() => source.getActiveFile()),
    activeMarkdownView: Effect.sync(() =>
      source.getActiveViewOfType(MarkdownView),
    ),
    onFileMenu: (handler) =>
      menuHook(
        "file-menu",
        // oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
        (
          menu: Menu,
          file: TAbstractFile,
          from: string,
          leaf: WorkspaceLeaf | undefined,
        ) => handler(menu, file, { source: from, leaf }),
      ),
    onEditorMenu: (handler) =>
      menuHook(
        "editor-menu",
        (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) =>
          handler(menu, editor, info),
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
