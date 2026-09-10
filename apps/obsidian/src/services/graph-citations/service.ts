// The Graph Citations service: installs the render facade and the click and right-click wraps on every graph leaf, re-renders on index changes, and restores every swapped member on feature-off and unload (ADR 0029).

import type {
  App,
  GraphRenderer,
  GraphView,
  View,
  WorkspaceLeaf,
} from "obsidian";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { graphCitationAdditions, NO_ADDITIONS } from "./adapter";
import type { GraphCitationAdditions } from "./adapter";
import { wrapNodeClick } from "./click";
import { renderWithFacade } from "./facade";
import {
  GRAPH_CORE_PLUGIN_ID,
  GRAPH_VIEW_TYPES,
  graphMembersOf,
  wrapMember,
} from "./install";
import type { GraphLeafMembers } from "./install";
import { wrapNodeRightClick } from "./right-click";
import type { NodeRightClickDeps } from "./right-click";

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
    "ready" | "citationsByPath" | "resolveCitekey" | "on"
  >;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "on">;
  citekeyEditor: Pick<CitekeyEditor, "openCitekey">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
}

/** What one installed leaf holds. */
interface GraphInstallation {
  members: GraphLeafMembers;
  restores: DisposableStack;
  /** What the last facaded render drew; the click wrap answers node ids from it. */
  additions: GraphCitationAdditions;
}

export class GraphCitations extends Service<void> {
  readonly #app;
  readonly #citationIndex;
  readonly #noteIndex;
  readonly #citekeyEditor;
  readonly #settings;
  /**
   * Keyed by renderer, which its view owns for life and destroys on close,
   * so a closed leaf's installation is collected with it and nothing is
   * stored on the plugin. Teardown restores what the live graph leaves hold.
   */
  readonly #installations = new WeakMap<GraphRenderer, GraphInstallation>();
  /** Views that failed the member check, so each is reported once. */
  readonly #leftNative = new WeakSet<View>();
  #enabled = true;
  #stopped = false;
  #renderTimer: ReturnType<typeof setTimeout> | null = null;

  ready: Promise<void>;

  constructor(deps: GraphCitationsDeps) {
    super();
    this.#app = deps.app;
    this.#citationIndex = deps.citationIndex;
    this.#noteIndex = deps.noteIndex;
    this.#citekeyEditor = deps.citekeyEditor;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await Promise.all([this.#settings.ready, this.#citationIndex.ready]);

    await using stack = new AsyncDisposableStack();
    const { workspace } = this.#app;
    stack.use(
      registerEvent(workspace.on("layout-change", () => this.#refresh())),
    );
    stack.use(
      registerEvent(workspace.on("active-leaf-change", () => this.#refresh())),
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
    if (enabled === this.#enabled) return;
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
      this.#install(members);
      this.#render(members);
    }
  }

  #install(members: GraphLeafMembers): void {
    const { engine, renderer, viewType } = members;
    const installation: GraphInstallation = {
      members,
      restores: new DisposableStack(),
      additions: NO_ADDITIONS,
    };
    const { restores } = installation;
    restores.use(
      wrapMember(engine, "render", (render) => () => {
        installation.additions = this.#additions();
        return renderWithFacade(engine, render, installation.additions);
      }),
    );
    const nodeDeps: NodeRightClickDeps = {
      citekeyOf: (id) => installation.additions.citedWorkNodes.get(id),
      resolveCitekey: (citekey) => this.#citationIndex.resolveCitekey(citekey),
      open: (citekey, pane) =>
        void this.#citekeyEditor.openCitekey(citekey, pane),
    };
    restores.use(wrapNodeClick(renderer, nodeDeps));
    restores.use(wrapNodeRightClick(renderer, nodeDeps));
    this.#installations.set(renderer, installation);
    logger.debug("Graph citations installed", { viewType });
  }

  /** Restores every installed leaf and draws each natively once. */
  #uninstallAll(): void {
    for (const { members, restores } of this.#installed()) {
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
      for (const { members } of this.#installed()) this.#render(members);
    }, RENDER_SETTLE_MS);
  }

  #render({ engine, viewType }: GraphLeafMembers): void {
    try {
      engine.render();
    } catch (error) {
      logger.warn("Graph render failed", { viewType, error });
    }
  }

  #additions(): GraphCitationAdditions {
    return graphCitationAdditions({
      occurrences: this.#citationIndex.citationsByPath(["citekey"]),
      resolveCitekey: (citekey) => this.#citationIndex.resolveCitekey(citekey),
      notePathsOf: (indexedKey) =>
        this.#noteIndex.getNotesByItemKey(indexedKey).map((note) => note.path),
      resolvedLinks: this.#app.metadataCache.resolvedLinks,
    });
  }

  /** The installations the live graph leaves hold, in leaf order. */
  #installed(): GraphInstallation[] {
    return this.#graphLeaves().flatMap((leaf) => {
      const { renderer } = leaf.view as GraphView;
      const installation = renderer && this.#installations.get(renderer);
      return installation ? [installation] : [];
    });
  }

  /** Every graph leaf in every window; `getLeavesOfType` walks the popouts too. */
  #graphLeaves(): WorkspaceLeaf[] {
    return GRAPH_VIEW_TYPES.flatMap((type) =>
      this.#app.workspace.getLeavesOfType(type),
    );
  }
}
