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
  /** Runtime members Obsidian's own popovers are driven by, verified against Obsidian 1.13.7. */
  interface HoverPopover {
    targetEl: HTMLElement | null;
    onTarget: boolean;
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
