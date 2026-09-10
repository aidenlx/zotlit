// The Graph Citations service: installs the render facade and the click, right-click and hover wraps on every graph leaf, re-renders on index changes, and restores every swapped member on feature-off and unload.

import type {
  App,
  GraphOptions,
  GraphRenderer,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import type { CitationSyntax } from "@/services/citation-index/scan";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { NavigationPane } from "@/services/citekey-navigation";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { graphCitationAdditions, NO_ADDITIONS } from "./adapter";
import type { GraphCitationAdditions } from "./adapter";
import { wrapNodeClick } from "./click";
import { renderWithFacade } from "./facade";
import { graphCitationFilters, installFilterRows } from "./filters";
import { wrapNodeHover } from "./hover";
import type { NodeHoverDeps } from "./hover";
import {
  GRAPH_CORE_PLUGIN_ID,
  GRAPH_VIEW_TYPES,
  graphMembersOf,
  wrapMember,
} from "./install";
import type { GraphLeafMembers } from "./install";
import { GraphNodeColors, installNodeColors } from "./node-color";
import { wrapNodeRightClick } from "./right-click";
import type { NodeRightClickDeps } from "./right-click";
import {
  deferredLeafOptions,
  savedGlobalOptions,
  savedLeafOptions,
} from "./saved-options";

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
  citationIndex: Pick<
    CitationIndex,
    "ready" | "citationsByPath" | "resolveCitekey" | "citekeyOf" | "on"
  >;
  noteIndex: Pick<NoteIndex, "getIndexedItemKeys" | "getNotesByItemKey" | "on">;
  citekeyEditor: Pick<CitekeyEditor, "openCitekey">;
  /** The entries a hovered Literature Note or Cited Work Node shows. */
  citationPopover: CitationPopover;
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
}

/**
 * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
 */
export class GraphCitations extends Service<void> {
  readonly #app;
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
  #renderTimer: ReturnType<typeof setTimeout> | null = null;

  ready: Promise<void>;

  constructor(deps: GraphCitationsDeps) {
    super();
    this.#app = deps.app;
    this.#citationIndex = deps.citationIndex;
    this.#noteIndex = deps.noteIndex;
    this.#citekeyEditor = deps.citekeyEditor;
    this.#citationPopover = deps.citationPopover;
    this.#settings = deps.settings;
    this.ready = this.#load();
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
          this.#requestRender();
        }),
      ),
    );
    for (const event of CITATION_INDEX_EVENTS) {
      stack.defer(this.#citationIndex.on(event, () => this.#requestRender()));
    }
    stack.defer(this.#noteIndex.on("changed", () => this.#requestRender()));
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
      this.#install(members, this.#savedOptions(leaf, members.viewType));
      this.#render(members);
    }
  }

  /**
   * The options this graph persisted, which it applied before ZotLit's rows
   * existed to hear them: the Graph core plugin's own for the global graph,
   * the leaf's saved state for a local one.
   */
  #savedOptions(leaf: WorkspaceLeaf, viewType: string): GraphOptions | null {
    if (viewType === "graph") return savedGlobalOptions(this.#app);
    return (
      this.#deferredOptions.get(leaf) ?? this.#savedLeaves.get(leaf.id) ?? null
    );
  }

  #install(members: GraphLeafMembers, saved: GraphOptions | null): void {
    const { engine, renderer, viewType } = members;
    const installation: GraphInstallation = {
      members,
      restores: new DisposableStack(),
      rows: this.#filterRows(engine, saved),
      additions: NO_ADDITIONS,
    };
    const { restores } = installation;
    restores.use(
      wrapMember(engine, "render", (render) => () => {
        installation.additions = this.#additions(engine);
        return renderWithFacade(engine, render, installation.additions);
      }),
    );
    restores.defer(() => installation.rows[Symbol.dispose]());
    restores.use(installNodeColors(renderer, installation, this.#nodeColors));
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
    logger.debug("Graph citations installed", { viewType });
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
        this.#savedOptions(leaf, installation.members.viewType),
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
      const { members, restores } = installation;
      restores.dispose();
      this.#installations.delete(members.renderer);
      this.#render(members);
      logger.debug("Graph citations restored", { viewType: members.viewType });
    }
  }

  /** Coalesces a burst of index events into one re-render of every installed leaf. */
  #requestRender(): void {
    if (this.#stopped || !this.#enabled) return;
    if (this.#renderTimer !== null) clearTimeout(this.#renderTimer);
    this.#renderTimer = setTimeout(() => {
      this.#renderTimer = null;
      for (const { installation } of this.#installed()) {
        this.#render(installation.members);
      }
    }, RENDER_SETTLE_MS);
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
      citationIndex: this.#citationIndex,
      settings: this.#settings,
      citationPopover: this.#citationPopover,
      open: this.#open,
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
