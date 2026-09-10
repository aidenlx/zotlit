import "obsidian";

declare global {
  /** Obsidian bundles turndown and exposes its constructor as a runtime global. */
  const TurndownService: typeof import("turndown").default;

  /**
   * The same detached-element factories the bare globals expose
   * (`createDiv()` etc., see `interface Node` in `obsidian.d.ts`), patched
   * onto every window — main and popout alike — so a detached element built
   * from a specific `doc.win` lands in that window's own document instead of
   * always the main one. Missing from the vendored `obsidian-api` typings.
   */
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void,
    ): HTMLElementTagNameMap[K];
    createDiv(
      o?: DomElementInfo | string,
      callback?: (el: HTMLDivElement) => void,
    ): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void,
    ): HTMLSpanElement;
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
  }
}

declare module "obsidian" {
  interface ViewStateResult {
    /** Runs after native group assignment and ephemeral handoff (Obsidian 1.14). */
    done?: () => void;
  }
  interface WorkspaceLeaf {
    /** Refreshes native tab text and tooltip after selection changes (Obsidian 1.14). */
    updateHeader(): void;
    /** Native descriptor/ephemeral history capture; verified in Obsidian 1.14. */
    recordHistory(state: unknown): void;
    /** Native leaf identity, serialized by the workspace. */
    id: string;
    /** Native link and pin state, serialized by the workspace (Obsidian 1.14). */
    group: string | null;
    pinned: boolean;
  }
  interface ItemView {
    /** Native content header title; refreshed separately from the tab (Obsidian 1.14). */
    titleEl: HTMLElement;
  }
  interface WorkspaceContainer {
    /**
     * Restores and focuses this desktop window. Unlike Workspace.revealLeaf,
     * this also works when a detached Settings window has focus.
     * Internal; verified against Obsidian 1.13.7 and 1.14.0.
     */
    focus(): void;
  }
  interface TextFileView {
    /** Native unsaved-text marker used by external-file three-way merging. */
    dirty: boolean;
    /** Native saved-text baseline and file-read/merge boundary (Obsidian 1.14). */
    lastSavedData: string | null;
    loadFileInternal(file: TFile, clear: boolean): Promise<void>;
  }
  interface FileView {
    /** Keeps an in-memory document leaf open before its first vault write. */
    allowNoFile: boolean;
  }
  interface Vault {
    /** Reads an app setting; `readableLineLength` is Settings → Editor → Readable line length. */
    getConfig(key: "readableLineLength"): boolean;
  }
  interface Workspace {
    on(
      name: "zotlit:workbench-selection",
      callback: (
        selection: import("../views/profile-editor/selection").WorkbenchSelectionEvent,
      ) => void,
      ctx?: any,
    ): EventRef;
    /** Active/recent navigating FileView, also used by native Outline. */
    getActiveFileView(): FileView | null;
    /**
     * Re-reads the serialized layout Obsidian restored this session's leaves
     * from, `{}` when it cannot. Internal; shape verified against Obsidian
     * 1.13.7 and 1.14.0. Optional so a build that drops it is a guarded
     * branch, not a crash.
     */
    readWorkspaceFile?(): Promise<unknown>;

    on(
      name: "zotlit:insert-template-field",
      callback: (request: {
        leaf: WorkspaceLeaf;
        node: import("@zotlit/workbench/explorer").DisplayNode;
      }) => void,
      ctx?: any,
    ): EventRef;

    on(
      name: "quick-preview",
      callback: (file: TFile, source: string) => void,
      ctx?: any,
    ): EventRef;
    on(
      name: "zotlit:authoring-context",
      callback: (
        context: import("@/views/profile-editor/view").ProfileAuthoringContext,
      ) => void,
      ctx?: any,
    ): EventRef;

    on(
      name: "zotlit:switch-profile",
      callback: (request: { path: string }) => void,
      ctx?: any,
    ): EventRef;
  }
  interface MetadataCache {
    /**
     * Runs `callback` once the cache is clean (no parse in progress, resolver
     * queue idle): at once if it already is, else after the next drain.
     * Internal; shape verified against Obsidian 1.13.7. Optional so a build
     * that drops it is a runtime branch, not a crash.
     */
    onCleanCache?(callback: () => void): void;
    /**
     * Every path the cache holds — the file list one graph render walks to
     * build its nodes. Internal; shape verified against Obsidian 1.13.7 and
     * 1.14.0. Optional so a build that drops it is a guarded branch.
     */
    getCachedFiles?(): string[];
  }
  /**
   * The core `graph` view (`leaf.view` of view type `"graph"`). Internal;
   * shape verified against Obsidian 1.13.7 and 1.14.0. Every member optional
   * so a build that drops one is a guarded branch, not a crash.
   */
  interface GraphView extends ItemView {
    renderer?: GraphRenderer;
    dataEngine?: GraphEngine;
  }
  /** The core `localgraph` view; same provenance as {@link GraphView}. */
  interface LocalGraphView extends ItemView {
    renderer?: GraphRenderer;
    engine?: GraphEngine;
  }
  /**
   * The graph data engine one view owns. `render()` reads `app` once at its
   * top and hands the result to `renderer.setData` — the seam Graph Citations
   * rests on. Internal; shape verified against Obsidian 1.13.7 and 1.14.0.
   *
   * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
   */
  interface GraphEngine {
    app?: App;
    /** Rebuilds the node set from scratch on every call; returns the link count. */
    render?(): unknown;
    /** What one render reads. Only a key some section owns ever lands here. */
    options?: GraphOptions;
    /** The Filters section of the controls panel. */
    filterOptions?: GraphControlSection;
    /** Saves the options where this graph persists them; debounced. */
    onOptionsChange?(): void;
    /**
     * The engine is the `HoverParent` of every hover its nodes answer: the
     * popover hangs off it, and the engine's own unhover transitions it.
     * Verified against Obsidian 1.14.1.
     */
    hoverPopover?: HoverPopover | null;
  }
  /**
   * One graph's options: the native keys, plus every key a controls-panel
   * section registered an option listener for. Persisted per graph — Graph
   * core plugin data for the global graph, leaf state for a local one.
   */
  type GraphOptions = Record<string, unknown>;
  /**
   * One section of the graph controls panel, `engine.filterOptions` and its
   * siblings. Internal; shape verified against Obsidian 1.13.7 and 1.14.0.
   */
  interface GraphControlSection {
    /** The section body, below its header: what a row is built into. */
    childrenEl: HTMLElement;
    /** Keyed by option key. `engine.getOptions` enumerates these, not `engine.options`. */
    optionListeners: Record<string, GraphOptionListener>;
    /**
     * What "Restore default settings" calls. It replays a fixed object of
     * native keys, so a plugin key is skipped: a plugin row reaches the
     * button only through a wrap of this member.
     */
    setDefaultOptions(): void;
  }
  /**
   * What one controls-panel row registers under its option key. Reads the
   * row's value, and writes it first when called with one. `any` because a
   * section holds rows of every control type, as Obsidian's own
   * `ValueComponent.registerOptionListener` declares them.
   */
  type GraphOptionListener = (value?: any) => any;
  /**
   * The PIXI renderer one view owns; the node callbacks are own properties
   * the engine binds in its constructor. Internal; shape verified against
   * Obsidian 1.13.7 and 1.14.0, the hover members against 1.14.1.
   */
  interface GraphRenderer {
    onNodeClick?: GraphNodeCallback;
    /**
     * The right-click callback, bound beside {@link onNodeClick} in the same
     * engine constructor and called by the renderer only where it is present.
     * Shape verified against Obsidian 1.13.7 and 1.14.1.
     */
    onNodeRightClick?: GraphNodeCallback;
    /** The data hand-off: diffs `data` into the live node set. */
    setData?(data: GraphData): void;
    /** Fired once as the pointer enters a node. */
    onNodeHover?: GraphNodeCallback;
    /** Fired as the pointer leaves the node it entered, and before every hover. */
    onNodeUnhover?: () => void;
    /** `div.graph-view`, `position: relative`, in the graph's own window. */
    containerEl?: HTMLElement;
    /** Every drawn node by id, positioned in world coordinates. */
    nodeLookup?: Record<string, { x: number; y: number } | undefined>;
    /** World-to-screen: `screen_css = (world * scale + pan) / devicePixelRatio`. */
    scale?: number;
    panX?: number;
    panY?: number;
  }
  /**
   * @param id the node id: a vault path, an unresolved linkpath, or a tag.
   * @param type `""` for a note, else `"unresolved"`, `"tag"`, `"attachment"`, or `"focused"`.
   */
  type GraphNodeCallback = (evt: MouseEvent, id: string, type: string) => void;
  /**
   * The whole node set one render drew, keyed by node id. Internal; shape
   * verified against Obsidian 1.13.7 through 1.14.1.
   */
  interface GraphData {
    nodes: Record<string, GraphDataNode>;
  }
  interface GraphDataNode {
    /** As {@link GraphNodeCallback} spells it. */
    type: string;
    /**
     * The colour the node is drawn in, ahead of the one its type carries. The
     * engine writes a matching colour group's colour here before the hand-off,
     * and leaves it absent for every other node.
     */
    color?: GraphColor | null;
  }
  /** A graph colour: an alpha, and the channels packed `(r << 16) | (g << 8) | b`. */
  interface GraphColor {
    a: number;
    rgb: number;
  }

  interface App {
    /** Stable per-vault id, the namespace Obsidian gives its own IndexedDB databases. */
    appId: string;
    plugins: {
      plugins: Record<string, unknown>;
    };
    internalPlugins: {
      /** The enabled core plugin instance, or null when disabled/absent. */
      getEnabledPluginById(id: string): unknown;
    };
    setting: SettingsModal;
    commands: {
      executeCommandById(id: string): boolean;
    };
  }

  /** The settings modal (`app.setting`). Internal; shape verified against Obsidian 1.13. */
  interface SettingsModal extends Modal {
    /** Tab rendered into the content pane, or null while none is open. */
    activeTab: SettingTab | null;
    /** Index backing the settings search box. */
    searchIndex: SettingsSearchIndex;
    /** Open a tab by id, searching built-in tabs then plugin tabs. Returns null when the id is unknown. Opening the modal is a separate {@link Modal.open} call. */
    openTabById(id: string): SettingTab | null;
    /** Render a tab, closing any open sub-pages. */
    openTab(tab: SettingTab): void;
    /**
     * Open a tab, descend its `pagePath` sub-pages, then reveal `result`'s definition.
     * Reads only the listed fields, so synthetic arguments navigate without a real search.
     */
    navigateToSearchResult(
      group: Pick<SettingsSearchGroup, "tab" | "pagePath">,
      result?: Pick<SettingsSearchResult, "entry">,
    ): void;
    /** Scroll the row for `definition` into view and flash it. Requires `tab` to be the rendered tab or sub-page. */
    scrollToDefinition(tab: SettingTab, definition: SettingDefinition): void;
  }

  /** Flattened index over every registered tab's `settingItems`. */
  interface SettingsSearchIndex {
    tabs: SettingTab[];
    /** Every searchable definition across all tabs, with the path that reaches it. */
    getEntries(): SettingsSearchEntry[];
    /** Simple search over name, desc, and aliases, grouped by page and sorted by score. */
    search(query: string): SettingsSearchGroup[];
  }

  /** A definition plus the tab and sub-page path that reach it. */
  interface SettingsSearchEntry {
    tab: SettingTab;
    definition: SettingDefinition;
    /** Innermost page definition; absent at the tab root. */
    page?: SettingDefinitionPage;
    /** Sub-page `name` values, outermost first. Empty at the tab root. */
    pagePath: string[];
  }

  /** Search hits sharing one tab and sub-page. */
  interface SettingsSearchGroup {
    tab: SettingTab;
    page?: SettingDefinitionPage;
    pagePath: string[];
    tabNameMatch: SearchResult | null;
    results: SettingsSearchResult[];
    bestScore: number;
  }

  /** One matched definition inside a {@link SettingsSearchGroup}. */
  interface SettingsSearchResult {
    entry: SettingsSearchEntry;
    nameMatch: SearchResult | null;
    descMatch: SearchResult | null;
    score: number;
    matches: SearchMatches;
  }

  interface SettingTab {
    /** Tab id. A `PluginSettingTab` takes `plugin.manifest.id`. */
    id: string;
    /** Sidebar label. A `PluginSettingTab` takes `plugin.manifest.name`. */
    name: string;
  }

  /** Position-resolved link/tag token from {@link Editor.getClickableTokenAt}. */
  interface ClickableToken {
    type: string;
    text: string;
    start: EditorPosition;
    end: EditorPosition;
  }
  interface Editor {
    getClickableTokenAt(pos: EditorPosition): ClickableToken | null;
    /**
     * The CodeMirror 6 view behind the editor. Obsidian's own `Editor` methods
     * read it unconditionally, so every editor handed to a command has it.
     */
    cm: import("@codemirror/view").EditorView;
  }
  interface MarkdownView {
    /** Live-preview / source edit sub-view; absent in pure reading mode. */
    editMode?: MarkdownEditView;
  }
  interface MarkdownEditView {
    triggerClickableToken(
      token: ClickableToken,
      newLeaf: boolean | PaneType,
    ): void;
  }
  interface MenuItem {
    /** Convert this item into a submenu parent, returning the nested {@link Menu} to populate. Runtime API present since Obsidian 1.4, absent from the vendored typings. */
    setSubmenu(): Menu;
  }
  interface EditorSuggest<T> {
    /** Undocumented internal driving the popover's selection; invoking it from a custom keymap handler selects the highlighted suggestion as if Enter were pressed. */
    suggestions: { useSelectedItem(evt: KeyboardEvent | MouseEvent): void };
  }
  /** The members Obsidian's runtime gives {@link PopoverState}; the vendored declaration lists none. */
  enum PopoverState {
    Showing = 0,
    Shown = 1,
    Hiding = 2,
    Hidden = 3,
  }
  /** Runtime members Obsidian's own popovers are driven by, verified against Obsidian 1.14.1. */
  interface HoverPopover {
    targetEl: HTMLElement | null;
    onTarget: boolean;
    /**
     * The pending show or hide timer. Obsidian arms it on `activeWindow` and
     * cancels it with the main window's `clearTimeout`, so a subclass that
     * must cancel it clears it on the window that armed it.
     */
    timer: number;
    /** Target listeners bound to the instance by the native constructor. */
    onMouseIn: (event: MouseEvent) => void;
    onMouseOut: (event: MouseEvent) => void;
    transition(): void;
    /**
     * What the wait timer armed in the constructor calls: the popover takes its
     * place in the document through {@link position}, then claims its parent
     * and loads. A subclass leaves this name to Obsidian, so that the sequence
     * runs and the popover reaches the screen.
     */
    show(): void;
    /**
     * Places `hoverEl` beside the target, recording the placement it chose as
     * an inline `top` or `bottom` style alone.
     */
    position(): void;
    hide(): void;
    /** Re-runs {@link position} as `el` resizes, which is what lets content arrive after the popover opens. */
    watchResize(el: HTMLElement): void;
    /**
     * The point {@link position} anchors to in place of the target's boxes.
     * Obsidian sets it from the pointer for a tall target; a subclass sets it
     * before each placement to anchor elsewhere. `null` uses the target.
     */
    staticPos: Point | null;
  }
}
