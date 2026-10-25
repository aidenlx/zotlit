// The workspace as a capability tag: layout readiness, the active file and
// editor, and the menu hooks ZotLit uses, without the Obsidian `App`. It copies
// the shape of ./obsidian-metadata-cache; policies/events.md (Capability tags)
// describes it. Views, leaves, `Component`s and React handlers stay edges and
// keep `app.workspace`.
import { Context, Effect, Layer } from "effect";
import type { Scope, Stream } from "effect";
import { MarkdownView } from "obsidian";
import type {
  Editor,
  MarkdownFileInfo,
  Menu,
  OpenViewState,
  PaneType,
  TAbstractFile,
  TFile,
  Workspace as ObsidianWorkspace,
  WorkspaceLeaf,
} from "obsidian";

import { logAndContinue } from "@/lib/effect-log";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  obsidianEventSource,
  obsidianListener,
} from "@/lib/obsidian-event-source";
import type { ObsidianEventEmitter } from "@/lib/obsidian-event-source";

/** The Obsidian object the tag reads: what `app.workspace` gives. */
export type WorkspaceSource = Pick<
  ObsidianWorkspace,
  | "onLayoutReady"
  | "getActiveFile"
  | "getActiveViewOfType"
  | "getLeavesOfType"
  | "updateOptions"
  | "openLinkText"
  | "getLeaf"
  | "trigger"
  | "requestActiveLeafEvents"
> &
  ObsidianEventEmitter;

/** One workspace event, tagged with its Obsidian event name. */
export type WorkspaceEvent =
  /** The active file changed; `null` when no file is active. */
  | { readonly _tag: "file-open"; readonly file: TFile | null }
  /** A leaf opened, closed or moved. */
  | { readonly _tag: "layout-change" };

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
  /** Obsidian's `getActiveFile()` now. */
  readonly getActiveFile: Effect.Effect<TFile | null>;
  /** The Markdown view of the active leaf now, `null` when it holds none. */
  readonly activeMarkdownView: Effect.Effect<MarkdownView | null>;
  /**
   * The Markdown view of each open Markdown leaf now, in Obsidian's leaf
   * order: the editors a decoration change reaches, and the reading views a
   * re-render reaches.
   */
  readonly markdownViews: Effect.Effect<readonly MarkdownView[]>;
  /**
   * Obsidian's `updateOptions()`: every editor reads the registered editor
   * extensions again, so a change to a registered extension array applies.
   */
  readonly updateOptions: Effect.Effect<void>;
  /**
   * Obsidian's undocumented `requestActiveLeafEvents.run()`: Obsidian defers
   * the active leaf's events, such as `file-open`; this delivers a deferred
   * one now.
   */
  readonly requestActiveLeafEvents: Effect.Effect<void>;
  /**
   * Obsidian's `openLinkText`: open `linktext`, resolved from `sourcePath`, in
   * the pane `newLeaf` names, with the view state `state`.
   */
  openLinkText(
    linktext: string,
    sourcePath: string,
    options?: {
      readonly newLeaf?: PaneType | boolean;
      readonly state?: OpenViewState;
    },
  ): Effect.Effect<void>;
  /**
   * Obsidian's `getLeaf`: a leaf in the pane `newLeaf` names, for a view to
   * open in.
   */
  getLeaf(newLeaf?: PaneType | boolean): Effect.Effect<WorkspaceLeaf>;
  /** Obsidian's `trigger`: raise the workspace event `name` with `data`. */
  trigger(name: string, ...data: unknown[]): Effect.Effect<void>;
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
  yield* events.listen(source, "layout-change", () => ({
    _tag: "layout-change",
  }));

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
    getActiveFile: Effect.sync(() => source.getActiveFile()),
    activeMarkdownView: Effect.sync(() =>
      source.getActiveViewOfType(MarkdownView),
    ),
    markdownViews: Effect.sync(() =>
      source
        .getLeavesOfType("markdown")
        .flatMap(({ view }) => (view instanceof MarkdownView ? [view] : [])),
    ).pipe(Effect.withSpan("Workspace.markdownViews")),
    updateOptions: Effect.sync(() => source.updateOptions()).pipe(
      Effect.withSpan("Workspace.updateOptions"),
    ),
    requestActiveLeafEvents: Effect.sync(() =>
      source.requestActiveLeafEvents.run(),
    ).pipe(Effect.withSpan("Workspace.requestActiveLeafEvents")),
    openLinkText: Effect.fn("Workspace.openLinkText")(
      (linktext, sourcePath, options = {}) =>
        Effect.promise(() =>
          source.openLinkText(
            linktext,
            sourcePath,
            options.newLeaf,
            options.state,
          ),
        ),
    ),
    getLeaf: Effect.fn("Workspace.getLeaf")((newLeaf) =>
      Effect.sync(() => source.getLeaf(newLeaf)),
    ),
    // Untraced: a citation raises its menus from a pointer handler.
    trigger: Effect.fnUntraced(function* (name, ...data) {
      yield* Effect.sync(() => source.trigger(name, ...data));
    }),
    onFileMenu: Effect.fn("Workspace.onFileMenu")((handler) =>
      menuHook(
        "file-menu",
        // Obsidian's own `file-menu` arguments.
        (
          ...[menu, file, from, leaf]: [
            Menu,
            TAbstractFile,
            string,
            WorkspaceLeaf | undefined,
          ]
        ) => handler(menu, file, { source: from, leaf }),
      ),
    ),
    onEditorMenu: Effect.fn("Workspace.onEditorMenu")((handler) =>
      menuHook(
        "editor-menu",
        (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) =>
          handler(menu, editor, info),
      ),
    ),
  });
});

/** The tag over any object of the workspace's shape, such as a test host's. */
export const layerWorkspaceFrom = (
  source: WorkspaceSource,
): Layer.Layer<Workspace> => Layer.effect(Workspace, makeWorkspace(source));

/**
 * Obsidian's `trigger` over the tag, for plain code that raises a workspace
 * event, such as a hover handler: each call runs the tag's `trigger` with
 * `run`, the runner of the caller's layer.
 */
export function workspaceTrigger(
  workspace: Pick<WorkspaceShape, "trigger">,
  run: (effect: Effect.Effect<void>) => void,
): Pick<ObsidianWorkspace, "trigger"> {
  return { trigger: (name, ...data) => run(workspace.trigger(name, ...data)) };
}

/** The tag over the app's workspace. */
export const layerWorkspace: Layer.Layer<Workspace, never, ObsidianApp> =
  Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return yield* makeWorkspace(app.workspace);
    }),
  );
