import { ItemView, Scope } from "obsidian";
import type {
  Menu as ObsidianMenu,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";
import type { AnnotViewAttachment } from "@zotlit/db";

import { registerMigratingWindowEvent } from "@/lib/disposables";
import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { ItemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import {
  annotationCapabilityAtom,
  attachmentCapabilityAtom,
} from "@/services/annotation-repository/atoms";
import type {
  AnnotationRecord,
  AnnotationSource,
  HistoryDirection,
} from "@/services/annotation-repository/service";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import { pickItem } from "@/services/item-lookup/search-modal";
import { libraryRowsAtom } from "@/services/library-scope/atoms";
import {
  liveUpdatesAtom,
  readerClosedAtom,
} from "@/services/local-server/atoms";
import {
  activeKeyAtom,
  activeNoteAtom,
  noteSourceAtom,
} from "@/services/note-index/atoms";
import { pdfSessionsAtom } from "@/services/pdf-annotation-editor/atoms";
import type { ReaderSession } from "@/services/reader-session/session";
import { ReaderSessionHost } from "@/services/reader-session/session";
import type { PluginSettings } from "@/services/settings/service";
import {
  zoteroRevisionAtom,
  zoteroStateAtom,
} from "@/services/zotero-reads/atoms";
import { viewTargetOpener } from "@/views/open-target";
import { readerText } from "@/views/query-view/reader-diagnostic";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps, QueryViewHost } from "@/views/query-view/view";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { startTemplateWorkbenchAction } from "@/views/template-workbench/actions";
import type { WorkbenchActionDeps } from "@/views/template-workbench/actions";

import type { AnnotActions } from "./actions";
import { AnnotView } from "./AnnotView";
import {
  makeTargetRead,
  readerResolutionAtom,
  resultValue,
  enableLiveUpdatesCommand,
} from "./atoms";
import { sanitizeSavedFilter } from "./filter";
import type { SavedFilter } from "./filter";
import { SidebarFilterModal } from "./filter-modal";
import type { AnnotationsLayout } from "./layout";
import {
  holdAnnotViewModel,
  observeRead,
  pinCurrentItem,
  pinItem,
  sameAnnotViewState,
  setFollowMode,
  unpin,
} from "./model";
import type { AnnotViewModel } from "./model";
import type { AnnotStore } from "./model";
import { buildPaneMenu } from "./pane-menu";
import { resolveLoadTarget } from "./resolve-target";
import type { ActiveLeafTarget, LoadTarget } from "./resolve-target";
import { saveSidebarAsQueryFile } from "./save-query-file";
import { addSidebarQueryMenu, sidebarQueryText } from "./sidebar-query";
import { INITIAL_FILTER_STATE, selectActiveAttachment } from "./state";
import type { AnnotState, FollowMode } from "./state";
import {
  parseAnnotViewState,
  readSidebarQuery,
  serializeAnnotViewState,
} from "./view-state";
import type { AnnotViewState } from "./view-state";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const logger = getLogger(["views", "annot-view"]);

/**
 * How long the view keeps the last Item while it reads the next one, before
 * it shows the next one's name over its cards loading.
 */
const STAGED_LOADING_MS = 150;

/** The next Item while its reads run, and what the store takes to show it. */
interface Staged {
  load: object;
  /** The store's state that shows the next Item. */
  patch: Partial<AnnotState>;
  /** The Item and Attachment the query reads for it, once its attachments are read. */
  bound: { itemKey: string | null; attachmentKey: string | null } | null;
  /** Whether its reads have taken {@link STAGED_LOADING_MS}. */
  late: boolean;
  timer: { win: Window; id: number } | null;
}

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";
const FILTER_STORAGE_KEY_PREFIX = "zotlit-annot-filter-";

/**
 * The sections the view header's "More options" menu registers before the
 * view fills it, in its order. Verified against Obsidian 1.14.4's
 * `ItemView.onMoreOptions`.
 */
const VIEW_MENU_SECTIONS = [
  "close",
  "pane",
  "open",
  "action",
  "find",
  "info",
  "info.copy",
  "view",
  "view.linked",
  "system",
  "",
  "danger",
] as const;

/**
 * Every member is a structural `Pick` of the full service sized to what the view
 * touches, so the real services satisfy it as-is and target-resolution logic can
 * be unit-tested against plain stubs.
 *
 * The database reads here await ZoteroReads, and what is on screen stays
 * until a read replaces it. The Libraries are the Held Read Library Scope
 * keeps. The Annotations come from the repository through the Annotations
 * Layout, which may answer from the Zotero Local API.
 */
export interface AnnotViewDeps extends QueryViewDeps {
  /** The shared item picker still consumes settings through its bridge. */
  bridge: Pick<EffectBridge, "runSync">;
  /** Every open Obsidian PDF view, as the Reader Session it exposes. */
  itemLookup: Pick<ItemLookupHandle, "openSession">;
  settings: Pick<PluginSettings["Service"], "current">;
  /** The plugin's view registry, which holds each leaf's Follow Mode state. */
  registry: ViewRegistryHandle;
  /** What an open of the Template data explorer runs with. */
  explorer: WorkbenchActionDeps;
}

export class AnnotationView extends ItemView implements HistorySurface {
  override scope: Scope;
  /**
   * The Query View the sidebar is: the Annotations of the followed Attachment,
   * through `attachment == this.attachment`.
   */
  readonly #query: QueryView;
  /** Whether Zotero's data cannot be read, which the sidebar says in place of cards. */
  #unreadable = false;
  /** The Query File the sidebar runs, once a change made it differ from the default. */
  get #queryText(): string | null {
    return this.#deps.registry.get(this.model.query);
  }
  /** The cards, their store, their actions, the Card Selection and the card keys. */
  readonly #layout: AnnotationsLayout;
  readonly #store: AnnotStore;
  readonly #deps: AnnotViewDeps;
  /** This leaf's Follow Mode state, held in the plugin's view registry. */
  readonly model: AnnotViewModel;
  #release: (() => void) | null;
  #opened: DisposableStack | null = null;
  #loadDisposables: DisposableStack | null = null;
  /** The load whose reads run; a later load or a clear supersedes it. */
  #loading: object | null = null;
  /** The Zotero Reader, translated into Indexed Keys. */
  #zoteroReader: ReaderSessionHost | null = null;
  #targetRead: Disposable | null = null;
  /** The active leaf's PDF view session, while one is being followed. */
  #leafSession: (() => void) | null = null;
  /** What the attachment choice and the saved filter are remembered against. */
  #memoryKey: string | null = null;
  #itemKey: string | null = null;
  /** The last load's attachment read, and the Annotation reads it started. */
  #reading = Promise.resolve();
  /** Whether the view has closed, which the work it started away reads. */
  #closed = false;
  /**
   * The next Item while its reads run. The view keeps the Item it shows,
   * its name, its attachments and its cards, until the next one's cards are
   * read, and then shows the next one whole; `null` with none waiting.
   */
  #staged: Staged | null = null;

  /**
   * Settles once the list on screen matches the last read this view started.
   * Never rejects.
   */
  get read(): Promise<void> {
    return this.#reading.then(() => this.#query.settled);
  }

  /** This leaf's Follow Mode state, as the registry holds it. */
  get #followState(): AnnotViewState {
    return this.#deps.registry.get(this.model.state);
  }

  get #followMode(): FollowMode {
    return this.#followState.followMode;
  }

  constructor(leaf: WorkspaceLeaf, deps: AnnotViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
    this.#query = new QueryView(deps, {
      scope: this.scope,
      sourcePath: () => this.#sourcePath(),
      context: () => {
        const { itemKey, attachmentKey } = this.#bound();
        return {
          item: itemKey ?? undefined,
          attachment: attachmentKey ?? undefined,
        };
      },
      contextSource: "sidebar",
      // The header names the Item the cards belong to, and changes with them.
      keepsRowsOnRebind: true,
      save: (text) => {
        this.#deps.registry.set(this.model.query, text);
      },
      layout: {
        ...this.#layoutHost(),
        showNewRecords: true,
        // The next Item shows with its cards, in the render that draws them.
        publishing: (attachmentKeys) => {
          const staged = this.#staged;
          const key = staged?.bound?.attachmentKey;
          return staged && key && attachmentKeys.includes(key)
            ? this.#takeStaged(staged)
            : null;
        },
      },
      // The followed Attachment's own list, so its first new Annotation shows
      // as the write starts, before the database has it.
      attachments: () => {
        const key = this.#bound().attachmentKey;
        return key === null ? [] : [key];
      },
    });
    this.#layout = this.#query.layout;
    this.#store = this.#layout.store;
    this.model = this.#store.model;
    // Obsidian may set the workspace state before the view opens.
    this.#release = this.#holdModel();
  }

  #holdModel(): () => void {
    return holdAnnotViewModel(this.#deps.registry, this.model);
  }

  /** The sidebar's own gestures and list frame, which its cards answer through. */
  #layoutHost(): QueryViewHost["layout"] {
    return {
      gestures: {
        // The last Item's attachments choose nothing while the next one reads.
        setSelectedAttachmentKey: (key) => {
          if (!this.#staged)
            this.#store.setState({ selectedAttachmentKey: key });
        },
        onSetFollowMode: (mode) => this.#setFollowMode(mode),
        onPinCurrentItem: () => this.#pinCurrentItem(),
        onPinItem: () => this.#pickItemToPin(),
        onUnpin: () => this.#unpin(),
        onEnableLiveUpdates: () => this.#enableLiveUpdates(),
        onOpenPdf: () => this.#openPdf(),
        fillViewMenu: (menu) => this.#fillViewMenu(menu),
        onExploreAnnotation: (annotationKey) => {
          if (!this.#itemKey) return;
          startTemplateWorkbenchAction(
            this.#deps.explorer,
            "open-template-data-explorer",
            openTemplateDataExplorer(this.#deps.app, {
              itemIndexedKey: this.#itemKey,
              anchorAnnotationKey: annotationKey,
            }),
          );
        },
      },
      // A click on the empty list leaves the focus on the body, and the key
      // reaches this view's Scope only while the view is the active leaf.
      onList: (node) =>
        node === this.containerEl ||
        node === this.contentEl ||
        node === node.doc.body,
      // Otherwise Obsidian moves focus to the last navigable leaf: right from
      // the sidebar, but in the main area that switches the tab away from
      // this view, so the key stops here.
      onEscape: () => {
        const { leftSplit, rightSplit } = this.#deps.app.workspace;
        const root = this.leaf.getRoot();
        if (root === leftSplit || root === rightSplit) return;
        return false;
      },
    };
  }

  override getViewType(): string {
    return ANNOT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.annot_view_name();
  }

  override getIcon(): string {
    return "highlighter";
  }

  override getState(): Record<string, unknown> {
    const query = this.#queryText;
    return {
      ...serializeAnnotViewState(this.#followState),
      ...(query !== null && { query }),
    };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    // A mode this build cannot name, or a pin with no Item, takes the default
    // rather than a source that cannot answer. Every other stored mode is kept
    // whether or not its source answers right now.
    this.#deps.registry.set(this.model.state, parseAnnotViewState(state));
    // The restored Query File runs with the Attachment the reload shows.
    this.#deps.registry.set(this.model.query, readSidebarQuery(state));
    this.#reload();
  }

  /**
   * What this view is showing, as its own surfaces read it: the pane menu, the
   * React tree through the store, and the commands through the accessors below.
   */
  get snapshot(): Readonly<
    AnnotState & { annotationSource: AnnotationSource | null }
  > {
    const state = this.#store.getState();
    const { selectedAttachmentKey } = state;
    return {
      ...state,
      // Which Annotation Source answered for the Attachment on screen.
      annotationSource:
        selectedAttachmentKey === null
          ? null
          : (state.sources.get(selectedAttachmentKey)?.source ?? null),
    };
  }

  /**
   * The gestures this view publishes to its React tree and its pane menu — the
   * mode switches, the pin, "Turn on live updates", "Refresh data". `null`
   * before the view opens.
   *
   * Named apart from `actions`, which `ItemView` itself uses for the view
   * header's action buttons.
   */
  get gestures(): AnnotActions | null {
    return this.#layout.actions;
  }

  /**
   * The Attachment whose Annotation History this view steps, which is the one
   * its cards show; `null` while it shows none. An Attachment no PDF view has
   * open holds no history, so the verbs that read this find nothing to take.
   */
  get historyAttachment(): string | null {
    return this.#store.getState().selectedAttachmentKey;
  }

  /**
   * Step one confirmed edit of the Attachment this view shows, from a card's
   * undo key or from the palette. An edit made on a card and one made in a PDF
   * view of the same Attachment are one history, in the order they were made.
   *
   * The repository decides and writes; this seam shows its answer — a step
   * Zotero moved under says so, a write that did not land says why, and a
   * block is reported the way every other blocked edit gesture is.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  stepHistory(direction: HistoryDirection): void {
    const attachmentKey = this.historyAttachment;
    if (attachmentKey === null) return;
    this.#layout.stepHistory(direction, attachmentKey);
  }

  /** "Refresh data" and the mode switches live here, off the toolbar row. */
  override onPaneMenu(menu: ObsidianMenu, source: string): void {
    super.onPaneMenu(menu, source);
    const actions = this.#layout.actions;
    if (!actions) return;
    const { file, view } = this.#query.state.getState();
    buildPaneMenu(menu, {
      state: this.snapshot,
      actions,
      now: Temporal.Now.instant(),
      query: (target) =>
        addSidebarQueryMenu(target, {
          view: file ? view : null,
          edit: (edit) => this.#query.document.editView(edit),
          openFilter: () =>
            new SidebarFilterModal(this.#deps.app, this.#query).open(),
          ...(file &&
            view &&
            this.#itemKey !== null && {
              saveAs: () => {
                const state = this.#store.getState();
                void saveSidebarAsQueryFile(this.#deps.app, {
                  file,
                  view,
                  filter: {
                    query: state.filterQuery,
                    colors: state.selectedColors,
                    tags: state.selectedTags,
                  },
                  itemKey: state.itemKey,
                  attachmentKey: state.selectedAttachmentKey,
                });
              },
            }),
        }),
    });
  }

  /**
   * The view header's "More options" menu, for the header row's own button:
   * the same sections, the same entries, and the same `leaf-menu` event.
   */
  #fillViewMenu(menu: ObsidianMenu): void {
    menu.addSections(VIEW_MENU_SECTIONS);
    this.onPaneMenu(menu, "more-options");
    this.#deps.app.workspace.trigger("leaf-menu", menu, this.leaf);
  }

  protected override async onOpen(): Promise<void> {
    const { registry } = this.#deps;
    const opened = new DisposableStack();
    this.#opened = opened;
    this.register(() => opened.dispose());
    this.#release ??= this.#holdModel();
    // Nothing else saves the workspace when the Follow Mode changes, so the
    // view asks for the save that carries it across a restart.
    let saved = registry.get(this.model.state);
    opened.defer(
      registry.subscribe(this.model.state, (state) => {
        if (sameAnnotViewState(state, saved)) return;
        saved = state;
        this.leaf.updateHeader();
        void this.#deps.app.workspace.requestSaveLayout();
      }),
    );

    this.#closed = false;
    opened.defer(
      registry.subscribe(this.model.query, () => {
        void this.#deps.app.workspace.requestSaveLayout();
      }),
    );
    this.#zoteroReader = new ReaderSessionHost({
      source: "zotero",
      navigate: (key) => this.#openInZotero(key),
      select: () => {},
    });
    opened.defer(() => this.#zoteroReader?.[Symbol.dispose]());
    opened.defer(
      registry.subscribe(
        readerResolutionAtom,
        (result) => {
          const resolution = resultValue(result);
          if (result.waiting) return;
          this.#zoteroReader?.setTarget(resolution?.target ?? null);
          this.#zoteroReader?.reportSelection(resolution?.selected ?? []);
        },
        { immediate: true },
      ),
    );
    opened.defer(registry.mount(enableLiveUpdatesCommand));
    this.#query.load();
    opened.defer(
      this.#query.state.subscribe(({ phase }, last) => {
        // A run for the next Item that fails shows the next Item, and says
        // so. A run that had failed before it says nothing of the next one.
        if (
          phase === "failed" &&
          last.phase !== "failed" &&
          this.#staged?.bound
        )
          this.#commitStaged(this.#staged);
        this.#syncQueryProblem();
      }),
    );

    this.#layout.render(this.contentEl, <AnnotView />);
    opened.defer(registry.subscribe(zoteroRevisionAtom, () => this.#reload()));
    opened.defer(registry.subscribe(zoteroStateAtom, () => this.#reload()));
    opened.defer(registry.subscribe(libraryRowsAtom, () => this.#reload()));
    // Evaluating the derived key starts its dependency on the active note.
    opened.defer(
      registry.subscribe(
        activeKeyAtom,
        () => {
          if (this.#followMode === "active-tab") this.#reload();
        },
        { immediate: true },
      ),
    );
    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () => {
        if (this.#deps.app.workspace.activeLeaf === this.leaf) {
          this.#layout.revalidate();
        }
        // A pane without a file can clear the target while the note atom
        // still holds the key of the note that becomes active again.
        if (this.#followMode === "active-tab") this.#reload();
      }),
    );

    opened.defer(
      registry.subscribe(
        pdfSessionsAtom,
        () => {
          if (this.#followMode === "active-tab") this.#reload();
        },
        { immediate: true },
      ),
    );

    const windowFocus = registerMigratingWindowEvent(
      this.containerEl,
      "focus",
      () => this.#layout.revalidate(),
    );
    opened.defer(() => windowFocus[Symbol.dispose]());

    const zoteroReader = this.#zoteroReader;
    opened.defer(
      zoteroReader.on("target-changed", () => {
        if (this.#followMode === "zotero-reader") this.#reload();
      }),
    );
    opened.defer(
      zoteroReader.on("selection-changed", () =>
        this.#layout.readerSelectionChanged(zoteroReader),
      ),
    );

    opened.defer(
      registry.subscribe(
        liveUpdatesAtom,
        (available) => {
          this.#store.setState({ liveUpdatesOn: available });
          if (this.#followMode === "zotero-reader") this.#reload();
        },
        { immediate: true },
      ),
    );
    opened.defer(
      registry.subscribe(
        readerClosedAtom,
        (closed) => {
          this.#store.setState({ zoteroReaderClosed: closed });
        },
        { immediate: true },
      ),
    );
    opened.defer(
      registry.subscribe(
        annotationCapabilityAtom,
        () => this.#syncCapability(),
        { immediate: true },
      ),
    );
    // The capability the header reports is the Attachment's, so it moves with
    // the Attachment as well as with the probe.
    opened.defer(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        () => {
          this.#syncCapability();
        },
      ),
    );

    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#opened?.dispose();
    this.#opened = null;
    this.#loading = null;
    this.#targetRead?.[Symbol.dispose]();
    this.#targetRead = null;
    this.#cancelStaged();
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#leafSession?.();
    this.#leafSession = null;
    // The layout saves an open card editor and unmounts the cards.
    this.#query.unload();
    this.#release?.();
    this.#release = null;
  }

  // #region follow mode

  /**
   * Every mode change runs through here, and every caller is a user gesture:
   * the mode button, the pane menu, or one of the five commands. Nothing else
   * writes the mode.
   *
   * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
   */
  #setFollowMode(mode: Exclude<FollowMode, "pinned">): void {
    this.#commitMode(setFollowMode(mode));
  }

  /**
   * Pins the Item on screen. Taken from an Obsidian PDF view this releases that
   * view's attachment lock, so the choice the PDF made becomes the remembered
   * one and the picker starts there.
   */
  #pinCurrentItem(): void {
    const { pinnable, selectedAttachmentKey } = this.#store.getState();
    if (pinnable === null) return; // nothing on screen carries an Item
    if (selectedAttachmentKey !== null) {
      this.#saveAttachmentSelection(pinnable, selectedAttachmentKey);
    }
    this.#commitMode(pinCurrentItem(pinnable));
  }

  /**
   * Open the Attachment on screen in Obsidian's own PDF view. A non-PDF
   * Attachment or a missing file is answered by the reader's own notice.
   */
  #openPdf(): void {
    const active = selectActiveAttachment(this.#store.getState());
    if (!active) return;
    viewTargetOpener(this.#deps.registry, this.#deps.opener).open(
      { kind: "attachment", attachmentKey: active.indexedKey },
      false,
    );
  }

  #pickItemToPin(): void {
    void pickItem(
      {
        app: this.#deps.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
        bridge: this.#deps.bridge,
      },
      m.annot_view_pin_placeholder(),
    ).then((hit) => {
      // The item index the picker searches excludes every child item type, so
      // a hit is always an Item a pin can name.
      // @see packages/db/src/queries/index-items.ts
      if (hit) this.#commitMode(pinItem(hit.item.indexedKey));
    });
  }

  #unpin(): void {
    this.#commitMode(unpin);
  }

  #commitMode(transition: (state: AnnotViewState) => AnnotViewState): void {
    const current = this.#followState;
    const next = transition(current);
    if (next === current) return;
    logger.debug("Follow mode changed by a gesture", { ...next });
    // A Follow Mode change clears the Card Selection; a reader the new mode
    // binds reports its own when the reload binds it.
    this.#layout.resetSelection();
    this.#deps.registry.set(this.model.state, next);
    this.#reload();
  }

  #enableLiveUpdates(): void {
    this.#deps.registry.set(enableLiveUpdatesCommand, undefined);
  }

  // #endregion

  // #region resolve + load

  #reload(): void {
    if (this.#closed) return;
    // Only Active Tab follows an open PDF's own session, so the subscription
    // stands exactly as long as that mode does.
    this.#followLeafSession(
      this.#followMode === "active-tab" ? this.#activePdfSession() : null,
    );
    this.#layout.bindReader(this.#followedSession());
    if (this.#deps.registry.get(zoteroStateAtom).state !== "ready") {
      this.#clearState();
      // A database still opening says nothing yet; one that failed says so.
      this.#unreadable =
        this.#deps.registry.get(zoteroStateAtom).state === "degraded";
      this.#syncQueryProblem();
      return;
    }
    this.#unreadable = false;
    this.#loadTarget(this.#resolveTarget());
  }

  /**
   * What stands in the way of the cards, from the Query View's own state:
   * Zotero's data that cannot be read, a failed query, or a filter condition
   * with an error under the last cards.
   */
  #syncQueryProblem(): void {
    const { phase, failure, results } = this.#query.state.getState();
    const failed = phase === "failed" && failure !== null;
    const keptResults = results !== null;
    this.#store.setState({
      queryProblem: this.#unreadable
        ? { message: m.annot_view_zotero_unreadable(), detail: "" }
        : failed && !keptResults
          ? {
              message: m.annot_view_query_failed(),
              detail: readerText(failure.diagnostic),
            }
          : null,
      filterError:
        !this.#unreadable &&
        failed &&
        keptResults &&
        failure.filterIssue !== null,
    });
  }

  #resolveTarget(): LoadTarget | null {
    const libraries = this.#deps.registry.get(libraryRowsAtom);
    switch (this.#followMode) {
      case "active-tab":
        return resolveLoadTarget({
          mode: "active-tab",
          leaf: this.#resolveActiveLeaf(),
          libraries,
        });
      case "zotero-reader":
        // Live updates is what carries the reader's position from Zotero, so
        // with it off this source answers nothing at all and the view offers
        // to turn it on, rather than showing an attachment no reader is on.
        return this.#store.getState().liveUpdatesOn
          ? resolveLoadTarget({
              mode: "zotero-reader",
              target: this.#zoteroReader?.target ?? null,
              libraries,
            })
          : null;
      case "pinned":
        return resolveLoadTarget({
          mode: "pinned",
          pinnedItemKey: this.#followState.pinnedItemKey,
          libraries,
        });
    }
  }

  /**
   * What the active tab offers: an open Zotero PDF through the Reader Session
   * the PDF annotation editor holds for it, or a Literature Note through its
   * frontmatter. A PDF the resolver does not know answers nothing rather than
   * falling through to the note path.
   */
  #resolveActiveLeaf(): ActiveLeafTarget | null {
    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (!activeFile) return null;
    const session = this.#activePdfSession();
    if (session) {
      return session.target ? { kind: "pdf", target: session.target } : null;
    }
    const itemKey = this.#deps.registry.get(activeNoteAtom).key;
    return itemKey === null ? null : { kind: "note", itemKey };
  }

  /**
   * Track the open PDF's own session while the active tab is what we follow,
   * and drop the subscription as soon as it is not — a session outlives no
   * mode it does not drive.
   */
  #followLeafSession(session: ReaderSession | null): void {
    this.#leafSession?.();
    this.#leafSession = null;
    if (!session) return;
    const stack = new DisposableStack();
    // The cards drive this selection, so a press on them is no click-away:
    // the card's own click says what becomes selected.
    stack.defer(session.addSelectionSurface(this.contentEl));
    stack.defer(session.on("target-changed", () => this.#reload()));
    stack.defer(
      session.on("selection-changed", () =>
        this.#layout.readerSelectionChanged(session),
      ),
    );
    this.#leafSession = () => stack.dispose();
  }

  /**
   * The Reader Session of the PDF view in the main area the researcher last
   * worked in, asked of that view itself: two tabs can show one file as two
   * Attachments that keep it.
   */
  #activePdfSession(): ReaderSession | null {
    const view = this.#deps.app.workspace.getMostRecentLeaf()?.view;
    return view
      ? (this.#deps.registry.get(pdfSessionsAtom).get(view) ?? null)
      : null;
  }

  #loadTarget(target: LoadTarget | null): void {
    if (!target) {
      this.#clearState();
      return;
    }

    const { itemKey, lockedAttachmentKey, lock, key, groupID } = target;
    // A standalone Attachment has no Item, so the Attachment itself is what
    // the attachment choice and the saved filter are remembered against.
    const memoryKey = itemKey ?? lockedAttachmentKey ?? key;
    const memoryChanged = memoryKey !== this.#memoryKey;
    this.#itemKey = itemKey;
    this.#memoryKey = memoryKey;

    // A new Item disposes the previous load's subscriptions before any state
    // mutation of this load: `subscribeWithSelector` fires synchronously, so
    // the next Item's state would otherwise trigger the old save
    // subscription (closed over the previous item's key) and wipe its
    // persisted filter. Its Annotation reads still running are superseded
    // too. A reload of the same Item keeps them until the new list lands, so
    // a choice made while it reads is still read and saved.
    if (memoryChanged) {
      this.#loadDisposables?.[Symbol.dispose]();
      this.#loadDisposables = null;
      this.#layout.cancelReads();
    }
    this.#targetRead?.[Symbol.dispose]();
    const read = observeRead(
      this.#deps.registry,
      makeTargetRead(target, this.#followMode),
    );
    this.#targetRead = read;
    const load = {};
    this.#loading = load;
    this.#cancelStaged();
    const state = {
      groupID,
      itemKey,
      attachmentLock: lock,
      pinnable: itemKey,
    } satisfies Partial<AnnotState>;

    if (memoryChanged) {
      this.#reading = this.#stage(
        target,
        { load, reading: read.promise },
        {
          ...INITIAL_FILTER_STATE,
          ...state,
        },
      );
      return;
    }

    // The same Item reads again: what is on screen stays while it reads,
    // the attachments and their Annotations until the new list lands.
    const sameItem = itemKey === this.#store.getState().itemKey;
    this.#store.setState({
      ...state,
      ...(!sameItem && { itemDisplay: null }),
    });
    this.#reading = read.promise.then((answer) => {
      if (!answer || this.#loading !== load) return;
      const { attachments, itemDisplay } = answer;
      this.#store.setState({ attachments, itemDisplay });
      const activeKey = this.#activeAttachment(target, attachments);
      this.#store.setState({ selectedAttachmentKey: activeKey });
      return this.#followAttachment(target, activeKey, {
        attachments,
        memoryChanged: false,
      });
    });
  }

  /**
   * Read the next Item while the one on screen stays: its name and its
   * attachments, then its cards, through the query bound to it. The next
   * Item shows whole once its cards are read, or with its cards loading
   * once the reads take {@link STAGED_LOADING_MS}.
   */
  async #stage(
    target: LoadTarget,
    {
      load,
      reading,
    }: {
      load: object;
      reading: Promise<{
        attachments: AnnotViewAttachment[];
        itemDisplay: ItemSummary | null;
      } | null>;
    },
    patch: Partial<AnnotState>,
  ): Promise<void> {
    const staged: Staged = {
      load,
      patch,
      bound: null,
      late: false,
      timer: null,
    };
    this.#staged = staged;
    const win = this.contentEl.win;
    staged.timer = {
      win,
      id: win.setTimeout(() => {
        staged.timer = null;
        staged.late = true;
        // The next Item's name, over its cards loading, once it is read.
        if (staged.bound) this.#commitStaged(staged, true);
      }, STAGED_LOADING_MS),
    };
    let attachments: AnnotViewAttachment[];
    let itemDisplay: ItemSummary | null;
    try {
      const answer = await reading;
      if (!answer) {
        if (this.#loading === load) this.#clearState();
        return;
      }
      ({ itemDisplay, attachments } = answer);
    } catch (err) {
      if (this.#loading !== load) return;
      logger.warn("Failed to load annot view data", {
        key: target.key,
        error: err,
      });
      this.#clearState();
      return;
    }
    if (this.#loading !== load) return;
    const activeKey = this.#activeAttachment(target, attachments);
    staged.patch = {
      ...staged.patch,
      itemDisplay,
      attachments,
      selectedAttachmentKey: activeKey,
    };
    if (activeKey === null) {
      // No cards to wait for: the next Item shows at once, with none.
      this.#commitStaged(staged);
      this.#query.clear();
      return;
    }
    staged.bound = { itemKey: target.itemKey, attachmentKey: activeKey };
    if (staged.late) this.#commitStaged(staged, true);
    return this.#followAttachment(target, activeKey, {
      attachments,
      memoryChanged: true,
    });
  }

  /** The Item and Attachment the query reads: the next Item's while it waits. */
  #bound(): { itemKey: string | null; attachmentKey: string | null } {
    const { itemKey, selectedAttachmentKey } = this.#store.getState();
    return (
      this.#staged?.bound ?? { itemKey, attachmentKey: selectedAttachmentKey }
    );
  }

  /** The state that shows the waiting Item, which then waits no more. */
  #takeStaged(staged: Staged): Partial<AnnotState> {
    if (staged.timer) staged.timer.win.clearTimeout(staged.timer.id);
    staged.timer = null;
    if (this.#staged === staged) this.#staged = null;
    return staged.patch;
  }

  /**
   * Show the waiting Item now, before its cards: with none of the last
   * Item's, which never show under the next one's name. Its own cards still
   * show, from the rows the query may already have landed for it.
   */
  #commitStaged(staged: Staged, loading = false): void {
    if (this.#staged !== staged) return;
    this.#store.setState(this.#takeStaged(staged));
    const attachmentKey = staged.bound?.attachmentKey;
    if (loading && attachmentKey) this.#layout.clearCardsFor(attachmentKey);
  }

  #cancelStaged(): void {
    if (this.#staged) this.#takeStaged(this.#staged);
  }

  /** The Attachment of `attachments` the view shows first: the locked, the saved, or the first. */
  #activeAttachment(
    { lockedAttachmentKey }: LoadTarget,
    attachments: readonly AnnotViewAttachment[],
  ): string | null {
    const held = (k: string | null): string | null =>
      k !== null && attachments.some((a) => a.indexedKey === k) ? k : null;
    const saved =
      lockedAttachmentKey === null && this.#memoryKey !== null
        ? this.#loadAttachmentSelection(this.#memoryKey)
        : null;
    return (
      held(lockedAttachmentKey) ??
      held(saved) ??
      attachments[0]?.indexedKey ??
      null
    );
  }

  /**
   * Shows the active Attachment's Annotations, and follows the choice of
   * Attachment and of filter, which are remembered for the Item.
   */
  #followAttachment(
    { lockedAttachmentKey, key, libraryID }: LoadTarget,
    activeKey: string | null,
    {
      attachments,
      memoryChanged,
    }: { attachments: readonly AnnotViewAttachment[]; memoryChanged: boolean },
  ): Promise<void> | undefined {
    const memoryKey = this.#memoryKey;
    if (activeKey === null || memoryKey === null) {
      this.#query.clear();
      return;
    }
    this.#loadDisposables?.[Symbol.dispose]();
    const load = new DisposableStack();
    this.#loadDisposables = load;
    const reading = this.#showAnnotations(activeKey, {
      restoreFilter: memoryChanged,
    });

    // A new Item takes its place on screen after this: its Attachment
    // showing is no choice.
    let placing = memoryChanged && this.#staged !== null;
    load.defer(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        (attachmentKey) => {
          if (placing) {
            placing = false;
            if (attachmentKey === activeKey) return;
          }
          if (attachmentKey === null) return;
          if (lockedAttachmentKey === null) {
            this.#saveAttachmentSelection(memoryKey, attachmentKey);
          }
          void this.#showAnnotations(attachmentKey, { restoreFilter: false });
        },
      ),
    );

    load.defer(
      this.#store.subscribe(
        (s) => [s.selectedColors, s.selectedTags] as const,
        ([colors, tags]) =>
          this.#saveFilterSelection(memoryKey, { colors, tags }),
        {
          equalityFn: ([aColors, aTags], [bColors, bTags]) =>
            aColors === bColors && aTags === bTags,
        },
      ),
    );

    logger.debug("Annot view loaded", {
      followMode: this.#followMode,
      key,
      libraryID,
      attachments: attachments.length,
    });
    return reading;
  }

  /**
   * Shows one Attachment's Annotations: the sidebar's Query File runs with the
   * Attachment as `this.attachment`. A new Item's first list brings back the
   * colour and tag filter saved for it.
   */
  #showAnnotations(
    attachmentKey: string,
    { restoreFilter }: { restoreFilter: boolean },
  ): Promise<void> {
    const memoryKey = this.#memoryKey;
    // The query runs again only for another Attachment or file: a database
    // change already runs it again through the Query View, and a reload for
    // the same Attachment (a tab switch, a note edit) changes nothing it reads.
    this.#query.setText(this.#queryText ?? sidebarQueryText());
    this.#query.contextChanged();
    return this.#query.settled.then(() => {
      const landed =
        this.#query.state.getState().phase === "ready" &&
        this.#store.getState().selectedAttachmentKey === attachmentKey;
      if (!landed || !restoreFilter || memoryKey === null) return;
      const { annotations } = this.#store.getState();
      const saved = this.#loadFilterSelection(memoryKey, annotations ?? []);
      if (saved) {
        this.#store.setState({
          selectedColors: saved.colors,
          selectedTags: saved.tags,
        });
      }
    });
  }

  /**
   * The Editing Capability the header reports: the Attachment's own, or —
   * with none on screen — the session's, which names no library.
   */
  #syncCapability(): void {
    const { selectedAttachmentKey } = this.#store.getState();
    this.#store.setState({
      capability:
        selectedAttachmentKey === null
          ? this.#deps.registry.get(annotationCapabilityAtom)
          : (resultValue(
              this.#deps.registry.get(
                attachmentCapabilityAtom(selectedAttachmentKey),
              ),
            ) ?? this.#deps.registry.get(annotationCapabilityAtom)),
    });
  }

  // #endregion

  /**
   * The Literature Note comment links resolve against — the loaded item's most
   * recent note. Falls back to the vault root when the item has no note yet, so
   * a relative link still resolves to something rather than failing.
   */
  #sourcePath(): string {
    if (this.#itemKey === null) return "";
    return this.#deps.registry.get(noteSourceAtom(this.#itemKey));
  }

  /**
   * Bring one Annotation's card forward and select it, from the Mark Popup in
   * the PDF reader or a notice. A card the list on screen does not hold is
   * left alone: the Follow Mode is the user's, and a reveal is not one of the
   * gestures that changes it.
   *
   * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
   */
  revealAnnotation(annotationKey: string): void {
    this.#layout.revealAnnotation(annotationKey);
  }

  /**
   * Pin the Item `itemKey`, as the researcher asked from another view: the
   * Library View's Reading Card opens an Item's Annotations here.
   *
   * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
   */
  pinItem(itemKey: string): void {
    this.#commitMode(pinItem(itemKey));
  }

  /** The reader this view's Follow Mode is driven by, while one answers. */
  #followedSession(): ReaderSession | null {
    switch (this.#followMode) {
      case "active-tab":
        return this.#activePdfSession();
      case "zotero-reader":
        return this.#zoteroReader;
      case "pinned":
        return null;
    }
  }

  /** Opens an Annotation in Zotero, the one gesture its reader accepts. */
  #openInZotero(annotationKey: string): void {
    const annot = this.#store
      .getState()
      .annotations?.find((record) => record.key === annotationKey);
    const annotation = annot && parseIndexedKey(annot.key);
    const attachment = annot && parseIndexedKey(annot.parentKey);
    if (!annot || !annotation || !attachment) return;
    this.contentEl.win.open(
      annotationOpenUri({
        attachmentKey: attachment.key,
        annotationKey: annotation.key,
        pageLabel: annot.pageLabel,
        groupID: annotation.groupID,
      }),
    );
  }

  #clearState(): void {
    this.#targetRead?.[Symbol.dispose]();
    this.#targetRead = null;
    this.#cancelStaged();
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#loading = null;
    this.#store.setState({
      ...INITIAL_FILTER_STATE,
      itemKey: null,
      itemDisplay: null,
      attachments: null,
      selectedAttachmentKey: null,
      attachmentLock: null,
      pinnable: null,
    });
    this.#query.clear();
    this.#itemKey = null;
    this.#memoryKey = null;
  }

  #loadAttachmentSelection(memoryKey: string): string | null {
    const raw = this.#deps.app.loadLocalStorage(STORAGE_KEY_PREFIX + memoryKey);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }

  #saveAttachmentSelection(memoryKey: string, attachmentKey: string): void {
    this.#deps.app.saveLocalStorage(
      STORAGE_KEY_PREFIX + memoryKey,
      attachmentKey,
    );
  }

  #loadFilterSelection(
    memoryKey: string,
    annots: readonly AnnotationRecord[],
  ): SavedFilter | null {
    const raw = this.#deps.app.loadLocalStorage(
      FILTER_STORAGE_KEY_PREFIX + memoryKey,
    );
    return sanitizeSavedFilter(raw, annots);
  }

  #saveFilterSelection(memoryKey: string, filter: SavedFilter): void {
    const { colors, tags } = filter;
    const key = FILTER_STORAGE_KEY_PREFIX + memoryKey;
    if (colors.length === 0 && tags.length === 0) {
      this.#deps.app.saveLocalStorage(key, null);
      return;
    }
    this.#deps.app.saveLocalStorage(key, JSON.stringify({ colors, tags }));
  }
}
