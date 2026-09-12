// The Graph Citations service: installs the render facade and the click, right-click and hover wraps on every graph leaf, re-renders on index changes, and restores every swapped member on feature-off and unload.

import { around } from "monkey-around";
import type {
  App,
  GraphOptions,
  GraphData,
  GraphRenderer,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import {
  getItemsByKey,
  resolveIndexedKeyLibrary,
  isChildItemFields,
} from "@zotlit/db";

import { disposable, registerEvent } from "@/lib/disposables";
import { workLabel } from "@/lib/item-summary";
import type { WorkLabel } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type { CitationSyntax } from "@/services/citation-index/scan";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { NavigationPane } from "@/services/citekey-navigation";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

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
import { installGraphViewCreation, installGraphViewState } from "./view-state";
import { WorkLabelGraphics, refreshWorkLabels } from "./work-labels";

const logger = getLogger("graph-citations");

/**
 * How long a burst of index events settles before one re-render. The
 * backfill emits `changed` once per file whose scan changed, so a first run
 * over a vault fires hundreds in a row; one render per event would rebuild
 * the whole graph that many times.
 */
const RENDER_SETTLE_MS = 150;

const CITATION_INDEX_EVENTS = [
  "changed",
  "backfilled",
  "resolution-changed",
  "membership-changed",
] as const;

export interface GraphCitationsDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client">;
  libraryScope: Pick<LibraryScopeService, "current">;
  citationIndex: Pick<
    CitationIndex,
    "ready" | "citationsByPath" | "resolveCitekey" | "citekeyOf" | "on"
  >;
  noteIndex: Pick<NoteIndex, "getIndexedItemKeys" | "getNotesByItemKey" | "on">;
  citekeyEditor: Pick<CitekeyEditor, "openCitekey" | "openIndexedKey">;
  /** The entries a hovered Literature Note or Cited Work Node shows. */
  citationPopover: Pick<CitationPopover, "showWork" | "hide">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
}

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
 * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
 */
export class GraphCitations extends Service<void> {
  readonly #app;
  readonly #db;
  readonly #libraryScope;
  #labels = new Map<string, WorkLabel | null>();
  readonly #citationIndex;
  readonly #noteIndex;
  readonly #citekeyEditor;
  readonly #citationPopover;
  readonly #settings;
  /** The Citekey Navigation open action, which every node surface runs. */
  readonly #open = (citekey: string, pane: NavigationPane): void => {
    void this.#citekeyEditor.openCitekey(citekey, pane);
  };
  /**
   * Keyed by renderer, which its view owns for life and destroys on close,
   * so a closed leaf's installation is collected with it and nothing is
   * stored on the plugin. Teardown restores what the live graph leaves hold.
   */
  readonly #installations = new WeakMap<GraphRenderer, GraphInstallation>();
  /** Views that failed the member check, so each is reported once. */
  readonly #leftNative = new WeakSet<View>();
  /** The node colours the theme states, shared by every installed leaf. */
  readonly #nodeColors = new GraphNodeColors();
  /** The citation edge colour the theme states, shared by every installed leaf. */
  readonly #linkColor = new GraphLinkColor();
  /**
   * What a still-deferred graph leaf carries, so a row installed after the
   * leaf loads starts where the user left it: the load applies the saved
   * state before any row exists to hear it.
   */
  readonly #deferredOptions = new WeakMap<WorkspaceLeaf, GraphOptions>();
  /** The same, by leaf id, for the leaves the layout loaded straight away. */
  #savedLeaves = new Map<string, GraphOptions>();
  #enabled = true;
  /** Whether the vault-wide setting admits wikilink citations. */
  #wikilinkCitations = false;
  #stopped = false;
  #renderPending = false;
  #renderTimer: ReturnType<typeof setTimeout> | null = null;

  ready: Promise<void>;

  constructor(deps: GraphCitationsDeps) {
    super();
    this.#app = deps.app;
    this.#db = deps.db;
    this.#libraryScope = deps.libraryScope;
    this.#citationIndex = deps.citationIndex;
    this.#noteIndex = deps.noteIndex;
    this.#citekeyEditor = deps.citekeyEditor;
    this.#citationPopover = deps.citationPopover;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  /**
   * Whether the vault-wide "Show citations in graph view" setting is on. The
   * first settings snapshot lands while {@link ready} is still pending, so a
   * caller that awaits `ready` reads the user's own choice.
   */
  get enabled(): boolean {
    return this.#enabled;
  }

  async #load(): Promise<void> {
    // Read before layout-ready where startup allows it: Obsidian saves the
    // layout no earlier, and a save made while ZotLit's rows are absent
    // writes their keys out of the file.
    const [, , savedLeaves] = await Promise.all([
      this.#settings.ready,
      this.#citationIndex.ready,
      savedLeafOptions(this.#app),
    ]);
    this.#savedLeaves = savedLeaves;

    await using stack = new AsyncDisposableStack();
    const { workspace } = this.#app;
    stack.use(
      installGraphViewCreation(this.#app, (leaf, view) => {
        if (this.#stopped || !this.#enabled) return;
        const members = graphMembersOf({ view });
        if (members) this.#install(leaf, members, { saved: null, view });
      }),
    );
    stack.use(
      registerEvent(workspace.on("layout-change", () => this.#refresh())),
    );
    stack.use(
      registerEvent(workspace.on("active-leaf-change", () => this.#refresh())),
    );
    // A node holds the colour it was stamped with until the next hand-off, so
    // a theme change is read again and drawn again.
    stack.use(
      registerEvent(
        workspace.on("css-change", () => {
          this.#nodeColors.invalidate();
          this.#linkColor.invalidate();
          this.#requestRender();
        }),
      ),
    );
    for (const event of CITATION_INDEX_EVENTS) {
      stack.defer(
        this.#citationIndex.on(event, () => this.#invalidateLabels()),
      );
    }
    stack.defer(this.#noteIndex.on("changed", () => this.#invalidateLabels()));
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    // The graph leaves exist only after layout-ready, and `onLayoutReady` is a
    // one-shot with no unregister, so the callback gates on disposal instead.
    workspace.onLayoutReady(() => this.#refresh());
    // Registered last, so it runs first on dispose: no re-render queued by an
    // event during teardown lands on a restored leaf.
    stack.defer(() => {
      this.#stopped = true;
      if (this.#renderTimer !== null) clearTimeout(this.#renderTimer);
      this.#uninstallAll();
    });
    this.commit(stack.move());
    logger.info("Graph citations ready", { enabled: this.#enabled });
  }

  /**
   * Turns a graph leaf one of the Citation Graph commands just opened into a
   * Citation Graph. Installing first is what makes ZotLit's keys land: a
   * controls-panel section writes only the keys its own rows answer, so the
   * rows have to stand before the preset names them.
   *
   * The preset persists with this view and native global graph bookmarks.
   * Other graph views keep their own choices.
   *
   * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
   */
  applyPreset(leaf: WorkspaceLeaf): void {
    this.#refresh();
    applyCitationGraphPreset(leaf, {
      wikilinkCitations: this.#wikilinkCitations,
      color: this.#nodeColors.literatureNoteGroupColor(),
    });
  }

  #applySettings(settings: Readonly<Settings>): void {
    const enabled = settings["citation.graph-citations"];
    const wikilinkCitations = settings["citation.wikilink-citations"];
    const rowsChanged = wikilinkCitations !== this.#wikilinkCitations;
    this.#wikilinkCitations = wikilinkCitations;
    if (enabled === this.#enabled) {
      // The "Wikilink citations" row is absent while the syntax is excluded,
      // so that choice rebuilds the rows of every installed leaf.
      if (enabled && rowsChanged) this.#rebuildRows();
      return;
    }
    this.#enabled = enabled;
    logger.debug("Graph citations toggled", { enabled });
    if (enabled) this.#refresh();
    else this.#uninstallAll();
  }

  /** Installs on every loaded graph leaf not yet installed, then draws each. */
  #refresh(): void {
    if (this.#stopped || !this.#enabled) return;
    if (!this.#app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID)) {
      logger.debug("Graph core plugin disabled; nothing to install");
      return;
    }
    for (const leaf of this.#graphLeaves()) {
      // A background tab holds a deferred placeholder with no engine
      // (Obsidian 1.7.2+). Loading it replaces the view and fires
      // `layout-change`, which lands here again with the real members.
      if (leaf.isDeferred) {
        const saved = deferredLeafOptions(leaf);
        if (saved) this.#deferredOptions.set(leaf, saved);
        logger.trace("Graph leaf deferred; install waits for its load", {
          viewType: leaf.view.getViewType(),
        });
        continue;
      }
      if (this.#leftNative.has(leaf.view)) continue;
      const { renderer } = leaf.view as GraphView;
      if (renderer && this.#installations.has(renderer)) continue;
      const members = graphMembersOf(leaf);
      if (!members) {
        this.#leftNative.add(leaf.view);
        continue;
      }
      this.#install(leaf, members, { saved: this.#savedOptions(leaf) });
      this.#render(members);
    }
  }

  /**
   * Startup options that arrived before ZotLit's controls existed. Consumed
   * after the first installation; later installations use the live choices.
   */
  #savedOptions(leaf: WorkspaceLeaf): GraphOptions | null {
    return (
      this.#deferredOptions.get(leaf) ?? this.#savedLeaves.get(leaf.id) ?? null
    );
  }

  #install(
    leaf: WorkspaceLeaf,
    members: GraphLeafMembers,
    { saved, view = leaf.view }: { saved: GraphOptions | null; view?: View },
  ): void {
    const { engine, renderer, viewType } = members;
    const installation: GraphInstallation = {
      members,
      restores: new DisposableStack(),
      rows: this.#filterRows(engine, saved),
      additions: NO_ADDITIONS,
      drawn: {},
      labels: new Map(),
      graphics: new WorkLabelGraphics(members),
    };
    const { restores } = installation;
    restores.use(installGraphViewState(view, engine));
    restores.defer(
      around(engine, {
        render: (render) => () => {
          installation.additions = this.#additions(engine);
          return renderWithFacade(engine, render, installation.additions);
        },
      }),
    );
    restores.defer(() => installation.rows[Symbol.dispose]());
    restores.use(installGroupsButton(engine, this.#nodeColors));
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
            const enabled = rowFlag(engine, AUTHOR_TITLE_LABELS, false);
            const drawn = enabled ? data.nodes : {};
            const previous = installation.drawn;
            installation.drawn = drawn;
            installation.graphics.update(
              enabled ? installation.labels : new Map(),
            );
            if (
              Object.keys(previous).length !== Object.keys(drawn).length ||
              Object.keys(drawn).some(
                (id) => previous[id]?.type !== drawn[id]?.type,
              )
            )
              this.#requestRender(false);
          },
        },
        this.#nodeColors,
      ),
    );
    restores.use(
      installLinkColors(members, installation, {
        color: this.#linkColor,
        enabled: () => colorCitationLinks(engine),
      }),
    );
    const nodeDeps: NodeRightClickDeps = {
      citekeyOf: (id) => installation.additions.citedWorkNodes.get(id),
      resolveCitekey: (citekey) => this.#citationIndex.resolveCitekey(citekey),
      open: this.#open,
    };
    restores.use(wrapNodeClick(renderer, nodeDeps));
    restores.use(wrapNodeRightClick(renderer, nodeDeps));
    restores.use(
      wrapNodeHover(members, this.#hoverDeps(), () => installation.additions),
    );
    this.#installations.set(renderer, installation);
    // The view closing is one of the two things that end this installation: a
    // closed leaf is gone from the walk the service tears down through, and
    // nothing native unhovers a node on the way out — so a hold left standing
    // would keep its popover on screen and its engine alive for as long as it
    // ran. The other is the feature turning off, which is why the callback is
    // released rather than left to the leaf: `Component.register` pushes onto
    // a list only `unload` drains and takes nothing back (`app.js` 1.14.1),
    // so a callback still holding this installation would outlive it.
    restores.use(releasedOnDispose(view, () => this.#uninstall(installation)));
    if (saved) engine.setOptions?.(saved);
    this.#savedLeaves.delete(leaf.id);
    this.#deferredOptions.delete(leaf);
    logger.debug("Graph citations installed", { viewType });
  }

  /** Puts one leaf's swapped members back and lets go of its installation. */
  #uninstall(installation: GraphInstallation): void {
    installation.restores.dispose();
    this.#installations.delete(installation.members.renderer);
    installation.drawn = {};
    installation.labels.clear();
    this.#fillLabels();
  }

  #filterRows(
    engine: GraphLeafMembers["engine"],
    saved: GraphOptions | null,
  ): Disposable {
    return installFilterRows(engine, {
      wikilinkCitations: this.#wikilinkCitations,
      saved,
    });
  }

  /**
   * Replaces the Filters rows of every installed leaf, keeping the render
   * facade: one render per leaf, and none of it drawn natively in between.
   */
  #rebuildRows(): void {
    for (const { leaf, installation } of this.#installed()) {
      installation.rows[Symbol.dispose]();
      installation.rows = this.#filterRows(
        installation.members.engine,
        this.#savedOptions(leaf),
      );
      this.#render(installation.members);
    }
    logger.debug("Graph rows rebuilt", {
      wikilinkCitations: this.#wikilinkCitations,
    });
  }

  /** Restores every installed leaf and draws each natively once. */
  #uninstallAll(): void {
    for (const { installation } of this.#installed()) {
      const { members } = installation;
      this.#uninstall(installation);
      this.#render(members);
      logger.debug("Graph citations restored", { viewType: members.viewType });
    }
  }

  /** Coalesces a burst of index events into one re-render of every installed leaf. */
  #requestRender(withRender = true): void {
    if (this.#stopped || !this.#enabled) return;
    this.#renderPending ||= withRender;
    if (this.#renderTimer !== null) clearTimeout(this.#renderTimer);
    this.#renderTimer = setTimeout(() => {
      this.#renderTimer = null;
      const render = this.#renderPending;
      this.#renderPending = false;
      const installed = this.#installed();
      if (render)
        for (const { installation } of installed)
          this.#render(installation.members);
      this.#fillLabels();
      for (const { installation } of installed)
        installation.graphics.update(installation.labels);
    }, RENDER_SETTLE_MS);
  }

  #invalidateLabels(): void {
    this.#labels.clear();
    this.#requestRender();
  }

  /** Runs in the render debounce, outside the synchronous hand-off and frame. */
  #fillLabels(): void {
    const needed = new Set<string>();
    const pending = this.#installed().map(({ installation }) => {
      const keys = new Map<string, string>();
      for (const [id, node] of Object.entries(installation.drawn)) {
        if (node.type === "tag" || node.type === "attachment") continue;
        let key = installation.additions.literatureNotes.has(id)
          ? (itemKeyFromFrontmatter(this.#app.metadataCache.getCache(id)) ??
            undefined)
          : undefined;
        const citekey = installation.additions.citedWorkNodes.get(id);
        if (citekey !== undefined) {
          const resolution = this.#citationIndex.resolveCitekey(citekey);
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
      return { installation, keys };
    });
    this.#labels = refreshWorkLabels(this.#labels, needed, (key) =>
      this.#readLabel(key),
    );
    for (const { installation, keys } of pending) {
      installation.labels.clear();
      for (const [id, key] of keys) {
        const label = this.#labels.get(key);
        if (label) installation.labels.set(id, label);
      }
    }
  }

  #readLabel(key: string): WorkLabel | null {
    try {
      if (this.#db.state !== "ready") return null;
      const selector = resolveIndexedKeyLibrary(this.#db.client, key);
      if (
        !selector ||
        !this.#libraryScope.current?.available.some(
          (library) => library.libraryID === selector.libraryID,
        )
      )
        return null;
      const item = getItemsByKey(this.#db.client, selector.libraryID, [
        selector.key,
      ])[0];
      return item && !isChildItemFields(item.fields)
        ? workLabel(item, item.fields)
        : null;
    } catch (error) {
      logger.warn("Graph Work Label metadata unavailable; left native", {
        indexedKey: key,
        error,
      });
      return null;
    }
  }

  #render({ engine, viewType }: GraphLeafMembers): void {
    try {
      engine.render();
    } catch (error) {
      logger.warn("Graph render failed", { viewType, error });
    }
  }

  /**
   * One walk per render answers every node the graph draws, the citing
   * sources a hover reads a work's entry out of among them; the hover itself
   * walks nothing.
   */
  #additions(engine: GraphLeafMembers["engine"]): GraphCitationAdditions {
    // Wikilink occurrences derive from the link cache on every call, so they
    // are asked for only while the vault-wide setting admits the syntax — the
    // one state in which a wikilink is a Citation at all, so also the one in
    // which it names a citing source or the row can take its edges away.
    const syntaxes: CitationSyntax[] = this.#wikilinkCitations
      ? ["citekey", "wikilink"]
      : ["citekey"];
    return graphCitationAdditions({
      occurrences: this.#citationIndex.citationsByPath(syntaxes),
      resolveCitekey: (citekey) => this.#citationIndex.resolveCitekey(citekey),
      resolveLink: (linkpath, sourcePath) =>
        this.#app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
          ?.path ?? null,
      notePathsOf: (indexedKey) => this.#notePathsOf(indexedKey),
      literatureNotes: this.#noteIndex
        .getIndexedItemKeys()
        .flatMap((indexedKey) => this.#notePathsOf(indexedKey)),
      resolvedLinks: this.#app.metadataCache.resolvedLinks,
      filters: graphCitationFilters(engine, {
        wikilinkCitations: this.#wikilinkCitations,
      }),
    });
  }

  #notePathsOf(indexedKey: string): string[] {
    return this.#noteIndex
      .getNotesByItemKey(indexedKey)
      .map((note) => note.path);
  }

  /** What a hovered node is read as a citation through. */
  #hoverDeps(): NodeHoverDeps {
    return {
      app: this.#app,
      settings: this.#settings,
      citationPopover: this.#citationPopover,
      open: (indexedKey, pane) => {
        void this.#citekeyEditor.openIndexedKey(indexedKey, pane);
      },
    };
  }

  /** The installations the live graph leaves hold, each with its leaf, in leaf order. */
  #installed(): { leaf: WorkspaceLeaf; installation: GraphInstallation }[] {
    return this.#graphLeaves().flatMap((leaf) => {
      const { renderer } = leaf.view as GraphView;
      const installation = renderer && this.#installations.get(renderer);
      return installation ? [{ leaf, installation }] : [];
    });
  }

  /** Every graph leaf in every window; `getLeavesOfType` walks the popouts too. */
  #graphLeaves(): WorkspaceLeaf[] {
    return GRAPH_VIEW_TYPES.flatMap((type) =>
      this.#app.workspace.getLeavesOfType(type),
    );
  }
}
