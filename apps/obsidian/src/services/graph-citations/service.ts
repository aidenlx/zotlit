// The Graph Citations service: installs the render facade and the click, right-click and hover wraps on every graph leaf, re-renders on index changes, and restores every swapped member on feature-off and unload.
import { Context, Effect, Exit, FiberHandle, Layer, Ref, Stream } from "effect";
import { around } from "monkey-around";
import type {
  GraphOptions,
  GraphData,
  GraphRenderer,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { disposable } from "@/lib/disposables";
import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { workLabel } from "@/lib/item-summary";
import type { WorkLabel } from "@/lib/item-summary";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace, workspaceTrigger } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import { heldResolution } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupObservation } from "@/services/citation-index/lookup-service";
import type { CitationSyntax } from "@/services/citation-index/scan";
import { CitationIndex } from "@/services/citation-index/service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import type { NavigationPane } from "@/services/citekey-navigation";
import { LibraryScope } from "@/services/library-scope/service";
import {
  itemKeyFromFrontmatter,
  NoteIndex,
} from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { changed as readsChanged } from "@/services/zotero-reads/events";
import type { WorkLabelSource } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { graphCitationAdditions, NO_ADDITIONS } from "./adapter";
import type { GraphCitationAdditions } from "./adapter";
import { wrapNodeClick } from "./click";
import {
  AUTHOR_TITLE_LABELS,
  colorCitationLinks,
  installDisplayRows,
} from "./display";
import { renderWithFacade } from "./facade";
import { graphCitationFilters, installFilterRows } from "./filters";
import { installGroupsButton } from "./groups";
import { wrapNodeHover } from "./hover";
import type { NodeHoverDeps } from "./hover";
import {
  GRAPH_CORE_PLUGIN_ID,
  GRAPH_VIEW_TYPES,
  graphMembersOf,
} from "./install";
import type { GraphLeafMembers } from "./install";
import { GraphLinkColor, installLinkColors } from "./link-color";
import { GraphNodeColors, installNodeColors } from "./node-color";
import { applyCitationGraphPreset } from "./preset";
import { wrapNodeRightClick } from "./right-click";
import type { NodeRightClickDeps } from "./right-click";
import { rowFlag } from "./rows";
import { deferredLeafOptions, savedLeafOptions } from "./saved-options";
import { installGraphViewState } from "./view-state";
import { WorkLabelGraphics } from "./work-labels";

/**
 * How long a burst of index events settles before one re-render. The
 * backfill emits `changed` once per file whose scan changed, so a first run
 * over a vault fires hundreds in a row; one render per event would rebuild
 * the whole graph that many times.
 */
const RENDER_SETTLE = "150 millis";

/** What one installed leaf holds. */
interface GraphInstallation {
  members: GraphLeafMembers;
  restores: DisposableStack;
  /**
   * The Filters rows, held apart from {@link restores} because the vault-wide
   * Wikilink Citations choice replaces them on their own, leaving the render
   * facade and the click wrap in place.
   */
  rows: Disposable;
  /** What the last facaded render drew; the click wrap answers node ids from it. */
  additions: GraphCitationAdditions;
  drawn: GraphData["nodes"];
  labels: Map<string, WorkLabel>;
  graphics: WorkLabelGraphics;
}

/** What one installation starts from. */
interface AttachOptions {
  /** The options the leaf saved before ZotLit's rows existed. */
  saved: GraphOptions | null;
  /** The view whose unload ends the installation. */
  view: View;
  /** Whether the vault-wide setting admits wikilink citations. */
  wikilinks: boolean;
}

/** A held Work Label, with the Library its work lives in. */
interface HeldLabel {
  readonly libraryID: number;
  readonly label: WorkLabel;
}

/** The label a work's label inputs format to; `null` where they give none. */
function heldLabel(source: WorkLabelSource | undefined): HeldLabel | null {
  const label = source ? workLabel(source, source) : null;
  return source && label ? { libraryID: source.libraryID, label } : null;
}

/**
 * Runs `callback` when `view` unloads, and no longer once the returned
 * Disposable is disposed.
 *
 * The registration itself cannot be taken back, so what it holds is let go of
 * instead: the callback the view keeps is a stand-in that answers nothing
 * after disposal, and the one that holds anything is reachable only through a
 * reference this scope drops.
 */
function releasedOnDispose(view: View, callback: () => void): Disposable {
  let held: (() => void) | null = callback;
  view.register(() => held?.());
  return disposable(() => {
    held = null;
  });
}

/**
 * Graph Citations: what the Citation Graph commands read and apply.
 *
 * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
 */
export class GraphCitations extends Context.Service<
  GraphCitations,
  {
    /**
     * Whether the vault-wide "Show citations in graph view" setting is on.
     * The first settings snapshot lands while the layer builds, so it reads
     * the user's own choice.
     */
    readonly enabled: Effect.Effect<boolean>;
    /**
     * Turns a graph leaf one of the Citation Graph commands just opened into
     * a Citation Graph. Installing first is what makes ZotLit's keys land: a
     * controls-panel section writes only the keys its own rows answer, so the
     * rows have to stand before the preset names them.
     *
     * The preset persists with this view and native global graph bookmarks.
     * Other graph views keep their own choices.
     */
    applyPreset(leaf: WorkspaceLeaf): Effect.Effect<void>;
  }
>()("zotlit/graph-citations/GraphCitations") {}

/**
 * Installs the render facade and the node wraps on every graph leaf while the
 * vault-wide setting is on, re-renders on index changes, and restores every
 * swapped member on feature-off and on unload. The graph view hooks are the
 * edge: each runs the layer's Effects with the layer's own context.
 *
 * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
 */
export const layerGraphCitations = Layer.effect(
  GraphCitations,
  Effect.gen(function* () {
    const env = yield* ObsidianEnv;
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const reads = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const citationIndex = yield* CitationIndex;
    const citationLookup = yield* CitationLookup;
    const noteIndex = yield* NoteIndex;
    const citekeyEditor = yield* CitekeyEditor;
    const citationPopover = yield* CitationPopover;
    const settings = yield* PluginSettings;
    const bridge = yield* scopedBridge;
    /** The runner of the graph view hooks, which Obsidian calls synchronously. */
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    // Read before layout-ready where startup allows it: Obsidian saves the
    // layout no earlier, and a save made while ZotLit's rows are absent
    // writes their keys out of the file.
    const savedLeaves = yield* Ref.make(
      yield* workspace.readWorkspaceFile.pipe(
        Effect.map((layout) => savedLeafOptions(layout)),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Workspace file unreadable; local graph rows start fresh",
          ).pipe(
            Effect.annotateLogs({ cause }),
            Effect.as(new Map<string, GraphOptions>()),
          ),
        ),
      ),
    );

    /**
     * The Work Labels of the drawn works by Indexed Key, a Held Read: a work
     * with no label holds `null`, and a label stays on screen while a fresh
     * read replaces it.
     */
    const labels = new Map<string, HeldLabel | null>();
    /** Held labels an invalidation marked stale; a fresh read replaces each. */
    const staleLabels = new Set<string>();
    /** The running `WorkLabels` read and the keys it answers. */
    const labelRead = yield* Ref.make<{
      readonly keys: ReadonlySet<string>;
    } | null>(null);
    const labelReads = yield* FiberHandle.make<void>();
    /**
     * The exact forward answers needed by the current graph facts. The render
     * wrap and the node wraps read it synchronously, inside Obsidian's calls.
     */
    let lookup: CitationLookupObservation | null = null;
    const installationCount = yield* Ref.make(0);
    /**
     * Keyed by renderer, which its view owns for life and destroys on close,
     * so a closed leaf's installation is collected with it and nothing is
     * stored on the plugin. Teardown restores what the live graph leaves hold.
     */
    const installations = new WeakMap<GraphRenderer, GraphInstallation>();
    /** Views that failed the member check, so each is reported once. */
    const leftNative = new WeakSet<View>();
    /** The node colours the theme states, shared by every installed leaf. */
    const nodeColors = new GraphNodeColors();
    /** The citation edge colour the theme states, shared by every installed leaf. */
    const linkColor = new GraphLinkColor();
    /**
     * What a still-deferred graph leaf carries, so a row installed after the
     * leaf loads starts where the user left it: the load applies the saved
     * state before any row exists to hear it.
     */
    const deferredOptions = new WeakMap<WorkspaceLeaf, GraphOptions>();
    const enabled = yield* Ref.make(true);
    /** Whether the vault-wide setting admits wikilink citations. */
    const wikilinkCitations = yield* Ref.make(false);
    const stopped = yield* Ref.make(false);
    const renderPending = yield* Ref.make(false);
    const renderTimer = yield* FiberHandle.make<void>();

    /** Whether the graph is to be drawn: the setting is on and the layer is open. */
    const active = Effect.gen(function* () {
      return (yield* Ref.get(enabled)) && !(yield* Ref.get(stopped));
    });

    /** What a hover or a right-click raises its workspace events on. */
    const triggerWorkspace = workspaceTrigger(workspace, run);
    /** The cache entry of a node's note, which a Literature Note is told by. */
    const cacheOf = (path: string) => run(metadata.cache(path));
    const resolveCitekey = (citekey: string) =>
      heldResolution(lookup?.current?.value ?? null, citekey);
    /**
     * The Citekey Navigation open action, which every node surface runs.
     * Unload interrupts a pending open.
     */
    const open = (citekey: string, pane: NavigationPane): void => {
      void bridge
        .runPromiseExit(citekeyEditor.openCitekey(citekey, pane))
        .then((exit) => valueOr(exit, undefined));
    };

    /** Lets go of the lookup once no installation reads it. */
    const releaseLookup = (): void => {
      lookup?.[Symbol.dispose]();
      lookup = null;
    };

    /** Every graph leaf in every window; `getLeavesOfType` walks the popouts too. */
    const graphLeaves = Effect.forEach(GRAPH_VIEW_TYPES, (type) =>
      workspace.leavesOfType(type),
    ).pipe(Effect.map((found) => found.flat()));

    /** The installations the live graph leaves hold, each with its leaf, in leaf order. */
    const installed = graphLeaves.pipe(
      Effect.map((leaves) =>
        leaves.flatMap((leaf) => {
          const { renderer } = leaf.view as GraphView;
          const installation = renderer && installations.get(renderer);
          return installation ? [{ leaf, installation }] : [];
        }),
      ),
    );

    const render = ({ engine, viewType }: GraphLeafMembers) =>
      Effect.suspend(() => {
        try {
          engine.render();
          return Effect.void;
        } catch (error) {
          return Effect.logWarning("Graph render failed").pipe(
            Effect.annotateLogs({ viewType, error }),
          );
        }
      });

    /**
     * One walk per render answers every node the graph draws, the citing
     * sources a hover reads a work's entry out of among them; the hover itself
     * walks nothing. Only the render wrap runs it, inside Obsidian's render:
     * it reads every input first, then builds the additions from them.
     */
    const additionsOf = Effect.fnUntraced(function* (
      engine: GraphLeafMembers["engine"],
    ) {
      const wikilinks = yield* Ref.get(wikilinkCitations);
      // Wikilink occurrences derive from the link cache on every call, so they
      // are asked for only while the vault-wide setting admits the syntax — the
      // one state in which a wikilink is a Citation at all, so also the one in
      // which it names a citing source or the row can take its edges away.
      const syntaxes: CitationSyntax[] = wikilinks
        ? ["citekey", "wikilink"]
        : ["citekey"];
      const occurrences = yield* citationIndex.citationsByPath(syntaxes);
      lookup?.set({
        citekeys: [
          ...new Set(
            [...occurrences.values()].flatMap((found) =>
              found.flatMap((occurrence) =>
                occurrence.kind === "citekey" ? [occurrence.raw] : [],
              ),
            ),
          ),
        ],
      });
      /** The path each wikilink reaches from its source, keyed by `linkKey`. */
      const linkKey = (linkpath: string, sourcePath: string) =>
        `${sourcePath}\0${linkpath}`;
      const linkTargets = new Map<string, string | null>();
      for (const [sourcePath, found] of occurrences) {
        for (const { kind, raw } of found) {
          const key = linkKey(raw, sourcePath);
          if (kind !== "wikilink" || linkTargets.has(key)) continue;
          const target = yield* metadata.firstLinkpathDest(raw, sourcePath);
          linkTargets.set(key, target?.path ?? null);
        }
      }
      /** The Literature Note paths of each Indexed Key, in Note Index order. */
      const notePaths = new Map<string, string[]>();
      for (const indexedKey of yield* noteIndex.getIndexedItemKeys) {
        const files = yield* noteIndex.getNotesByItemKey(indexedKey);
        notePaths.set(
          indexedKey,
          files.map((file) => file.path),
        );
      }
      const resolvedLinks = yield* metadata.resolvedLinks;
      return graphCitationAdditions({
        occurrences,
        resolveCitekey,
        resolveLink: (linkpath, sourcePath) =>
          linkTargets.get(linkKey(linkpath, sourcePath)) ?? null,
        notePathsOf: (indexedKey) => notePaths.get(indexedKey) ?? [],
        literatureNotes: [...notePaths.values()].flat(),
        resolvedLinks,
        filters: graphCitationFilters(engine, { wikilinkCitations: wikilinks }),
      });
    });

    /**
     * Coalesces a burst of index events into one re-render of every installed
     * leaf. Untraced: the backfill runs it once per changed file.
     */
    const requestRender = Effect.fnUntraced(function* (withRender: boolean) {
      if (!(yield* active)) return;
      if (withRender) yield* Ref.set(renderPending, true);
      yield* FiberHandle.run(renderTimer)(
        Effect.sleep(RENDER_SETTLE).pipe(
          Effect.andThen(flushRender),
          Effect.interruptible,
        ),
      );
    });

    /**
     * The settled render. Uninterruptible: a node hand-off inside the render
     * asks for the next one, which replaces this fiber, and this render still
     * shows its labels.
     */
    const flushRender: Effect.Effect<void> = Effect.gen(function* () {
      const rerender = yield* Ref.getAndSet(renderPending, false);
      const live = yield* installed;
      if (rerender)
        for (const { installation } of live)
          yield* render(installation.members);
      yield* showLabels;
    }).pipe(Effect.uninterruptible);

    const cancelLabelRead = Effect.gen(function* () {
      yield* Ref.set(labelRead, null);
      yield* FiberHandle.clear(labelReads);
    });

    /**
     * Marks every held label stale: each stays on screen until the fresh read
     * the next fill starts replaces it.
     */
    const invalidateLabels = Effect.gen(function* () {
      for (const key of labels.keys()) staleLabels.add(key);
      yield* cancelLabelRead;
      yield* requestRender(true);
    });

    /**
     * Reads the labels of `keys` off the main thread. When the read settles,
     * the labels it answered replace what was held and the graphics redraw; a
     * failed read keeps what was held and leaves the rest native. A new read
     * replaces the running one.
     */
    const readLabels: (keys: ReadonlySet<string>) => Effect.Effect<void> =
      Effect.fnUntraced(function* (keys) {
        if (yield* Ref.get(stopped)) return;
        const read = { keys };
        yield* Ref.set(labelRead, read);
        yield* FiberHandle.run(labelReads)(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(
              reads.reads.WorkLabels({ indexedKeys: [...keys] }),
            );
            // Uninterruptible: the fill below can start the next read, which
            // replaces this fiber, and these labels still show.
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                if ((yield* Ref.get(labelRead)) !== read) return;
                yield* Ref.set(labelRead, null);
                if (Exit.isSuccess(exit)) {
                  for (const key of keys) {
                    labels.set(key, heldLabel(exit.value.get(key)));
                    staleLabels.delete(key);
                  }
                } else {
                  yield* Effect.logWarning(
                    "Graph Work Label metadata unavailable; left native",
                  ).pipe(
                    Effect.annotateLogs({ keys: keys.size, cause: exit.cause }),
                  );
                  for (const key of keys) {
                    if (!labels.has(key)) labels.set(key, null);
                    staleLabels.delete(key);
                  }
                }
                if (!(yield* Ref.get(stopped))) yield* showLabels;
              }),
            );
          }).pipe(Effect.interruptible),
        );
      });

    /**
     * Runs outside the synchronous hand-off and frame: in the render debounce,
     * and when a label read settles. Reads only held labels; the keys it holds
     * nothing fresh for start one read.
     */
    const fillLabels: Effect.Effect<void> = Effect.gen(function* () {
      const needed = new Set<string>();
      const pending: {
        installation: GraphInstallation;
        keys: Map<string, string>;
      }[] = [];
      for (const { installation } of yield* installed) {
        const keys = new Map<string, string>();
        for (const [id, node] of Object.entries(installation.drawn)) {
          if (node.type === "tag" || node.type === "attachment") continue;
          let key = installation.additions.literatureNotes.has(id)
            ? (itemKeyFromFrontmatter(yield* metadata.cache(id)) ?? undefined)
            : undefined;
          const citekey = installation.additions.citedWorkNodes.get(id);
          if (citekey !== undefined) {
            const resolution = resolveCitekey(citekey);
            key =
              resolution?.kind === "unique"
                ? resolution.item.indexedKey
                : undefined;
          }
          if (key) {
            keys.set(id, key);
            needed.add(key);
          }
        }
        pending.push({ installation, keys });
      }
      // Only drawn works are retained.
      for (const key of labels.keys()) {
        if (needed.has(key)) continue;
        labels.delete(key);
        staleLabels.delete(key);
      }
      const missing = new Set(
        [...needed].filter((key) => !labels.has(key) || staleLabels.has(key)),
      );
      const reading = (yield* Ref.get(labelRead))?.keys;
      if (
        missing.size > 0 &&
        !(reading && [...missing].every((key) => reading.has(key)))
      )
        yield* readLabels(missing);

      const inScope = new Set(
        (yield* libraryScope.current)?.available.map(
          (library) => library.libraryID,
        ),
      );
      for (const { installation, keys } of pending) {
        installation.labels.clear();
        for (const [id, key] of keys) {
          const held = labels.get(key);
          if (held && inScope.has(held.libraryID))
            installation.labels.set(id, held.label);
        }
      }
    });

    /** Fills the labels of every installed leaf and hands them to its graphics. */
    const showLabels: Effect.Effect<void> = Effect.gen(function* () {
      yield* fillLabels;
      for (const { installation } of yield* installed)
        installation.graphics.update(installation.labels);
    });

    /** Puts one leaf's swapped members back and lets go of its installation. */
    const uninstall = Effect.fnUntraced(function* (
      installation: GraphInstallation,
    ) {
      if (installations.get(installation.members.renderer) !== installation)
        return;
      installation.restores.dispose();
      installations.delete(installation.members.renderer);
      if ((yield* Ref.updateAndGet(installationCount, (n) => n - 1)) === 0)
        releaseLookup();
      installation.drawn = {};
      installation.labels.clear();
      yield* fillLabels;
    });

    /** What a hovered node is read as a citation through. */
    const hoverDeps = (): NodeHoverDeps => ({
      workspace: triggerWorkspace,
      metadataCache: { getCache: cacheOf },
      settings,
      citationPopover,
      bridge,
      // Unload interrupts a pending open.
      open: (indexedKey, pane) => {
        void bridge
          .runPromiseExit(citekeyEditor.openIndexedKey(indexedKey, pane))
          .then((exit) => valueOr(exit, undefined));
      },
    });

    /**
     * Puts in new Filters rows for one installation, in place of the ones it
     * holds. The rows belong to the installation, so it releases them.
     */
    const replaceRows = (
      installation: GraphInstallation,
      saved: GraphOptions | null,
      wikilinks: boolean,
    ): void => {
      installation.rows[Symbol.dispose]();
      installation.rows = installFilterRows(installation.members.engine, {
        wikilinkCitations: wikilinks,
        saved,
      });
    };

    /**
     * Startup options that arrived before ZotLit's controls existed. Consumed
     * after the first installation; later installations use the live choices.
     */
    const savedOptions = (leaf: WorkspaceLeaf) =>
      Ref.get(savedLeaves).pipe(
        Effect.map(
          (saved) => deferredOptions.get(leaf) ?? saved.get(leaf.id) ?? null,
        ),
      );

    /**
     * Swaps the members of one graph leaf. The installation holds what it
     * swapped in a stack of its own, not on the layer Scope: it ends when its
     * view unloads or the setting turns off, and the layer's finalizer ends
     * every one that is left.
     */
    const attach = (
      members: GraphLeafMembers,
      { saved, view, wikilinks }: AttachOptions,
    ): GraphInstallation => {
      const { engine, renderer } = members;
      const installation: GraphInstallation = {
        members,
        restores: new DisposableStack(),
        rows: installFilterRows(engine, {
          wikilinkCitations: wikilinks,
          saved,
        }),
        additions: NO_ADDITIONS,
        drawn: {},
        labels: new Map(),
        graphics: new WorkLabelGraphics(members),
      };
      const { restores } = installation;
      restores.use(installGraphViewState(view, engine));
      restores.defer(
        around(engine, {
          render: (native) => () => {
            installation.additions = run(additionsOf(engine));
            return renderWithFacade(engine, native, installation.additions);
          },
        }),
      );
      restores.defer(() => installation.rows[Symbol.dispose]());
      restores.use(installGroupsButton(engine, nodeColors));
      restores.use(installDisplayRows(engine, { saved }));
      restores.use(installation.graphics);
      restores.use(
        installNodeColors(
          renderer,
          {
            get additions() {
              return installation.additions;
            },
            handedOff: (data) => {
              const shown = rowFlag(engine, AUTHOR_TITLE_LABELS, false);
              const drawn = shown ? data.nodes : {};
              const previous = installation.drawn;
              installation.drawn = drawn;
              installation.graphics.update(
                shown ? installation.labels : new Map(),
              );
              if (
                Object.keys(previous).length !== Object.keys(drawn).length ||
                Object.keys(drawn).some(
                  (id) => previous[id]?.type !== drawn[id]?.type,
                )
              )
                run(requestRender(false));
            },
          },
          nodeColors,
        ),
      );
      restores.use(
        installLinkColors(members, installation, {
          color: linkColor,
          enabled: () => colorCitationLinks(engine),
        }),
      );
      const nodeDeps: NodeRightClickDeps = {
        citekeyOf: (id) => installation.additions.citedWorkNodes.get(id),
        resolveCitekey,
        open,
        workspace: triggerWorkspace,
      };
      restores.use(wrapNodeClick(renderer, nodeDeps));
      restores.use(wrapNodeRightClick(renderer, nodeDeps));
      restores.use(
        wrapNodeHover(members, hoverDeps(), () => installation.additions),
      );
      // The view closing is one of the two things that end this installation: a
      // closed leaf is gone from the walk the service tears down through, and
      // nothing native unhovers a node on the way out — so a hold left standing
      // would keep its popover on screen and its engine alive for as long as it
      // ran. The other is the feature turning off, which is why the callback is
      // released rather than left to the leaf: `Component.register` pushes onto
      // a list only `unload` drains and takes nothing back (`app.js` 1.14.1),
      // so a callback still holding this installation would outlive it.
      restores.use(releasedOnDispose(view, () => run(uninstall(installation))));
      return installation;
    };

    const install = Effect.fnUntraced(function* (
      leaf: WorkspaceLeaf,
      members: GraphLeafMembers,
      { saved, view = leaf.view }: { saved: GraphOptions | null; view?: View },
    ) {
      const { engine, renderer, viewType } = members;
      // Every yield comes before `attach`: an interrupt between the wrappers
      // and `installations.set` would leave wrappers no uninstall can find.
      lookup ??= yield* citationLookup.observe(() => {
        void bridge.runPromise(invalidateLabels);
      });
      const wikilinks = yield* Ref.get(wikilinkCitations);
      const installation = attach(members, { saved, view, wikilinks });
      installations.set(renderer, installation);
      yield* Ref.update(installationCount, (n) => n + 1);
      if (saved) engine.setOptions?.(saved);
      yield* Ref.update(savedLeaves, (held) => {
        const next = new Map(held);
        next.delete(leaf.id);
        return next;
      });
      deferredOptions.delete(leaf);
      yield* Effect.logDebug("Graph citations installed").pipe(
        Effect.annotateLogs({ viewType }),
      );
    });

    /** Installs on every loaded graph leaf not yet installed, then draws each. */
    const refresh = Effect.gen(function* () {
      if (!(yield* active)) return;
      if (!(yield* env.corePluginEnabled(GRAPH_CORE_PLUGIN_ID))) {
        yield* Effect.logDebug(
          "Graph core plugin disabled; nothing to install",
        );
        return;
      }
      for (const leaf of yield* graphLeaves) {
        // A background tab holds a deferred placeholder with no engine
        // (Obsidian 1.7.2+). Loading it replaces the view and fires
        // `layout-change`, which lands here again with the real members.
        if (leaf.isDeferred) {
          const saved = deferredLeafOptions(leaf);
          if (saved) deferredOptions.set(leaf, saved);
          yield* Effect.logTrace(
            "Graph leaf deferred; install waits for its load",
          ).pipe(Effect.annotateLogs({ viewType: leaf.view.getViewType() }));
          continue;
        }
        if (leftNative.has(leaf.view)) continue;
        const { renderer } = leaf.view as GraphView;
        if (renderer && installations.has(renderer)) continue;
        const members = graphMembersOf(leaf);
        if (!members) {
          leftNative.add(leaf.view);
          continue;
        }
        yield* install(leaf, members, { saved: yield* savedOptions(leaf) });
        yield* render(members);
      }
    });

    /**
     * Replaces the Filters rows of every installed leaf, keeping the render
     * facade: one render per leaf, and none of it drawn natively in between.
     */
    const rebuildRows = Effect.gen(function* () {
      const wikilinks = yield* Ref.get(wikilinkCitations);
      for (const { leaf, installation } of yield* installed) {
        replaceRows(installation, yield* savedOptions(leaf), wikilinks);
        yield* render(installation.members);
      }
      yield* Effect.logDebug("Graph rows rebuilt").pipe(
        Effect.annotateLogs({
          wikilinkCitations: yield* Ref.get(wikilinkCitations),
        }),
      );
    });

    /** Restores every installed leaf and draws each natively once. */
    const uninstallAll = Effect.gen(function* () {
      for (const { installation } of yield* installed) {
        const { members } = installation;
        yield* uninstall(installation);
        yield* render(members);
        yield* Effect.logDebug("Graph citations restored").pipe(
          Effect.annotateLogs({ viewType: members.viewType }),
        );
      }
    });

    const applySettings = Effect.fnUntraced(function* (
      next: Readonly<Settings>,
    ) {
      const nextEnabled = next["citation.graph-citations"];
      const nextWikilinks = next["citation.wikilink-citations"];
      const rowsChanged =
        (yield* Ref.getAndSet(wikilinkCitations, nextWikilinks)) !==
        nextWikilinks;
      if (nextEnabled === (yield* Ref.get(enabled))) {
        // The "Wikilink citations" row is absent while the syntax is excluded,
        // so that choice rebuilds the rows of every installed leaf.
        if (nextEnabled && rowsChanged) yield* rebuildRows;
        return;
      }
      yield* Ref.set(enabled, nextEnabled);
      yield* Effect.logDebug("Graph citations toggled").pipe(
        Effect.annotateLogs({ enabled: nextEnabled }),
      );
      yield* nextEnabled ? refresh : uninstallAll;
    });

    yield* Effect.addFinalizer(() => Effect.sync(releaseLookup));
    // Installs before `load` / `setState`, so bookmark options find their controls.
    const viewCreationHooked = yield* host.onViewCreated(
      GRAPH_VIEW_TYPES,
      (leaf, view) =>
        run(
          Effect.gen(function* () {
            if (!(yield* active)) return;
            const members = graphMembersOf({ view });
            if (members) yield* install(leaf, members, { saved: null, view });
          }),
        ),
    );
    if (!viewCreationHooked)
      yield* Effect.logWarning(
        "Graph view factory unavailable; new views install on layout change",
      ).pipe(
        Effect.annotateLogs({
          missing: ["viewRegistry.getViewCreatorByType"],
        }),
      );
    yield* forkEach(
      filterTag(
        workspace.changes,
        "layout-change",
        "active-leaf-change",
        "css-change",
      ),
      (event) =>
        event._tag === "css-change"
          ? Effect.gen(function* () {
              // A node holds the colour it was stamped with until the next
              // hand-off, so a theme change is read again and drawn again.
              nodeColors.invalidate();
              linkColor.invalidate();
              yield* requestRender(true);
            })
          : refresh,
    );
    yield* forkEach(
      citationIndex.events.pipe(
        Stream.filter(
          (event) =>
            event.type === "changed" || event.type === "membership-changed",
        ),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(
      citationIndex.changes.pipe(
        Stream.map((state) => state.backfilled),
        Stream.changes,
        Stream.filter((backfilled) => backfilled),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(
      noteIndex.changes.pipe(
        Stream.filter(
          (change) => change.type === "changed" || change.type === "indexed",
        ),
      ),
      () => invalidateLabels,
    );
    yield* forkEach(readsChanged(reads), () => invalidateLabels);
    yield* forkEach(settings.changes, applySettings);
    // The graph leaves exist only after layout-ready.
    yield* workspace.layoutReady.pipe(
      Effect.andThen(refresh),
      Effect.forkScoped({ startImmediately: true }),
    );
    // Registered last, so it runs first on close: no re-render queued by an
    // event during teardown lands on a restored leaf.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Ref.set(stopped, true);
        yield* FiberHandle.clear(renderTimer);
        yield* cancelLabelRead;
        yield* uninstallAll;
      }),
    );
    yield* Effect.logInfo("Graph citations ready").pipe(
      Effect.annotateLogs({ enabled: yield* Ref.get(enabled) }),
    );

    return GraphCitations.of({
      enabled: Ref.get(enabled).pipe(Effect.withSpan("GraphCitations.enabled")),
      applyPreset: Effect.fn("GraphCitations.applyPreset")(function* (leaf) {
        yield* refresh;
        applyCitationGraphPreset(leaf, {
          wikilinkCitations: yield* Ref.get(wikilinkCitations),
          color: nodeColors.literatureNoteGroupColor(),
        });
      }),
    });
  }).pipe(withLogCategory("graph-citations")),
);
