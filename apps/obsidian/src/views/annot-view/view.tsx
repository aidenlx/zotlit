import { ItemView, Platform, Scope } from "obsidian";
import type {
  Menu as ObsidianMenu,
  App,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  annotationOpenUri,
  getAnnotationsByKey,
  getAnnotationsByParent,
  getAnnotViewAttachments,
  getAttachmentAnnotationCount,
  getAttachmentByItemId,
  getAttachmentByKey,
  getItemRefByID,
  getItemsByKey,
  getLibraries,
  isChildItemFields,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { AnnotViewAttachment, Library } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { AppContext } from "@/lib/app-context";
import {
  registerKeymap,
  registerMigratingWindowEvent,
} from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import type { ItemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import type {
  AnnotationRecord,
  AnnotationRepository,
  AnnotationSource,
  HistoryDirection,
} from "@/services/annotation-repository/service";
import {
  IDLE,
  writeFailureMessage,
} from "@/services/annotation-repository/write";
import type { DatabaseService } from "@/services/database/service";
import type { ExcerptDisplayService } from "@/services/excerpt-image/display";
import { savedExcerptRequest } from "@/services/excerpt-image/request";
import type { ExcerptRequest } from "@/services/excerpt-image/service";
import { pickItem } from "@/services/item-lookup/search-modal";
import type { ItemLookup } from "@/services/item-lookup/service";
import type {
  LocalServerService,
  ReaderTarget,
} from "@/services/local-server/service";
import type { NoteFeature } from "@/services/note-feature";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { NoteIndex } from "@/services/note-index/service";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import type { PdfAnnotationEditor } from "@/services/pdf-annotation-editor/service";
import type { ReaderSession } from "@/services/reader-session/session";
import { ZoteroReaderSession } from "@/services/reader-session/zotero";
import type { ZoteroReaderResolution } from "@/services/reader-session/zotero";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";

import { AnnotActionsContext, createAnnotActions } from "./actions";
import type { AnnotActions } from "./actions";
import { AnnotView } from "./AnnotView";
import { cardControls } from "./card-controls";
import type { CardControls } from "./card-controls";
import { NO_SELECTION, nextCardSelection, sameKeys } from "./card-selection";
import type {
  CardClick,
  CardSelection,
  SelectionChange,
} from "./card-selection";
import { createCommentRenderer } from "./comment-render";
import { createDragInsertHandler, createInsertHandler } from "./drag-insert";
import { sanitizeSavedFilter } from "./filter";
import type { SavedFilter } from "./filter";
import { mountCardHistoryKeys } from "./history";
import { buildPaneMenu } from "./pane-menu";
import { resolveLoadTarget } from "./resolve-target";
import type { ActiveLeafTarget, LoadTarget } from "./resolve-target";
import {
  AnnotStoreProvider,
  createAnnotStore,
  editorOpen,
  INITIAL_FILTER_STATE,
  toggledTags,
  visibleOrder,
} from "./store";
import type { AnnotState, FollowMode } from "./store";
import {
  DEFAULT_FOLLOW_MODE,
  parseAnnotViewState,
  serializeAnnotViewState,
  unpinnedMode,
} from "./view-state";
import type { AnnotViewState } from "./view-state";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const logger = getLogger(["views", "annot-view"]);

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";
const FILTER_STORAGE_KEY_PREFIX = "zotlit-annot-filter-";

/**
 * Every member is a structural `Pick` of the full service sized to what the view
 * touches, so the real services satisfy it as-is and target-resolution logic can
 * be unit-tested against plain stubs.
 *
 * The database reads here run synchronously within one tick (no `await` a
 * refresh swap could interleave with), matching the house sync-read pattern
 * (`protocol`, `citekey-editor`). The Annotations are the exception: they come
 * from the repository, which may answer from the Zotero Local API, so that one
 * read is awaited under a serial guard.
 */
export interface AnnotViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "on" | "ready">;
  liveUpdate: Pick<
    LocalServerService,
    "available" | "readerTarget" | "readerClosed" | "on"
  >;
  /** Every open Obsidian PDF view, as the Reader Session it exposes. */
  pdfReaders: Pick<PdfAnnotationEditor, "sessionForPath" | "on">;
  /**
   * The one read and write path for an Attachment's Annotations, so the cards
   * and the reader overlay show one Annotation Source's records rather than
   * two, and an edit stamps its precondition off the record they show.
   */
  annotations: Pick<
    AnnotationRepository,
    | "annotationState"
    | "capability"
    | "capabilityFor"
    | "commentDraftFor"
    | "deleteAnnotation"
    | "deleteAnnotations"
    | "discardCommentDraft"
    | "discardTagDraft"
    | "discardConflict"
    | "on"
    | "patchColor"
    | "editComment"
    | "editTags"
    | "peek"
    | "read"
    | "redo"
    | "refresh"
    | "retryWrite"
    | "retryCommentDraft"
    | "submitComment"
    | "submitTags"
    | "tagDraftFor"
    | "undo"
  >;
  /** Allow editing, from every entry the view offers, which the UI seam owns. */
  allowEditing: () => void;
  /**
   * An edit gesture met a block on this Attachment, which the one notice
   * ledger answers — the same seam the reader's blocked keystrokes reach.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  reportBlockedGesture: (attachmentKey: string) => void;
  /** The tag names of an Annotation's Library, which the tag editor suggests. */
  libraryTagNames: (annotationKey: string) => readonly string[];
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  /** The plugin's live display surface for Excerpt Images. */
  excerptDisplay: Pick<
    ExcerptDisplayService,
    "open" | "refresh" | "revalidate"
  >;
  noteFeature: Pick<
    NoteFeature,
    "renderAnnotationCitation" | "prepareAnnotationInsert"
  >;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  itemLookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
}

export class AnnotationView extends ItemView implements HistorySurface {
  override scope: Scope;
  readonly #store = createAnnotStore();
  readonly #deps: AnnotViewDeps;
  #root: Root | null = null;
  #actions: AnnotActions | null = null;
  #librariesCache: Library[] | null = null;
  #loadDisposables: DisposableStack | null = null;
  /** The Zotero Reader, translated into Indexed Keys. */
  #zoteroReader: ZoteroReaderSession | null = null;
  /** The active leaf's PDF view session, while one is being followed. */
  #leafSession: (() => void) | null = null;
  /**
   * The reader the Card Selection is kept in step with: the followed Obsidian
   * PDF view, or the Zotero Reader. `null` in Pinned and on a Literature Note.
   */
  #boundReader: ReaderSession | null = null;
  /**
   * Whether the bound reader's selection waits to replace the Card Selection:
   * an open card editor holds it back, or it names a key the list has not
   * loaded. The selection itself is read from the reader when it applies.
   */
  #readerPending = false;
  /**
   * The keys this view is sending to the bound Obsidian PDF view, while the
   * send runs. The reader reports them straight back, and that echo is the
   * view's own change: it leaves the anchor and the focus where they are.
   */
  #pushing: readonly string[] | null = null;
  /** What the attachment choice and the saved filter are remembered against. */
  #memoryKey: string | null = null;
  #itemKey: string | null = null;
  /** Counts the annotation reads, so a slower one never lands after a later one. */
  #reads = 0;
  #reading = Promise.resolve();
  /** Whether the view has closed, which the work it started away reads. */
  #closed = false;

  /**
   * Settles once the list on screen matches the last read this view started.
   * Never rejects.
   */
  get read(): Promise<void> {
    return this.#reading;
  }

  /** Follow mode lives in the store (single source of truth); read it here. */
  get #followMode(): FollowMode {
    return this.#store.getState().followMode;
  }

  constructor(leaf: WorkspaceLeaf, deps: AnnotViewDeps) {
    super(leaf);
    this.scope = new Scope(deps.app.scope);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
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
    const { followMode, previousMode, pinnedItemKey } = this.#store.getState();
    return serializeAnnotViewState({ followMode, previousMode, pinnedItemKey });
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    // A mode this build cannot name, or a pin with no Item, takes the default
    // rather than a source that cannot answer. Every other stored mode is kept
    // whether or not its source answers right now.
    this.#store.setState(parseAnnotViewState(state));
    this.#reload();
  }

  /**
   * What this view is showing, as its own surfaces read it: the pane menu, the
   * React tree through the store, and the commands through the accessors below.
   */
  get snapshot(): Readonly<AnnotState> {
    return this.#store.getState();
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
    return this.#actions;
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
    const stepping =
      direction === "undo"
        ? this.#deps.annotations.undo(attachmentKey)
        : this.#deps.annotations.redo(attachmentKey);
    void stepping.then((outcome) => {
      // The view can close while the step is away, and a closed view neither
      // scrolls nor speaks.
      if (this.#closed) return;
      switch (outcome.kind) {
        case "stepped":
          return this.#scrollToCard([outcome.annotationKey]);
        case "removed":
          // The step took its Annotations off the Attachment, so this view
          // has no card left to bring into view. The reader that holds the
          // PDF lands on the page they sat on.
          return;
        case "changed":
          new BaseNotice(m.annot_history_changed_in_zotero());
          return;
        case "failed":
          new BaseNotice(
            writeFailureMessage(outcome.failure, Temporal.Now.instant()),
          );
          return;
        case "blocked":
          this.#deps.reportBlockedGesture(attachmentKey);
          return;
        case "idle":
          return;
        default:
          // A new outcome must be answered here rather than fall through.
          outcome satisfies never;
          return;
      }
    });
  }

  /** "Refresh data" and the mode switches live here, off the toolbar row. */
  override onPaneMenu(menu: ObsidianMenu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source !== "more-options") return;
    const actions = this.#actions;
    if (!actions) return;
    buildPaneMenu(menu, {
      state: this.snapshot,
      actions,
      now: Temporal.Now.instant(),
    });
  }

  protected override async onOpen(): Promise<void> {
    this.#zoteroReader = new ZoteroReaderSession({
      liveUpdate: this.#deps.liveUpdate,
      resolve: (target) => this.#resolveZoteroReader(target),
      navigate: (annotationKey) => this.#openInZotero(annotationKey),
    });
    this.register(() => this.#zoteroReader?.[Symbol.dispose]());

    const insertDeps: Parameters<typeof createInsertHandler>[0] = {
      app: this.#deps.app,
      noteFeature: this.#deps.noteFeature,
      notify: (message) => void new BaseNotice(message),
      snapshot: (annotation) => {
        const state = this.#store.getState();
        return {
          source: state.annotations?.includes(annotation)
            ? state.annotationSource
            : null,
          sourceScope: state.annotationSourceScope,
        };
      },
    };
    const insert = createInsertHandler(insertDeps);
    const drag = createDragInsertHandler(insertDeps);
    this.register(insert.cancel);
    this.register(drag.cancel);

    this.#actions = createAnnotActions({
      app: this.#deps.app,
      excerptDisplay: this.#deps.excerptDisplay,
      excerptImageRequest: (target) => this.#excerptRequest(target),
      annotations: this.#deps.annotations,
      deleteControl: (annot) => this.#cardControls(annot).delete,
      selectedCards: () => this.#selectedCards(),
      resolveAnnotationID: (indexedKey) =>
        this.#resolveAnnotationID(indexedKey),
      libraryTagNames: (annot) => this.#deps.libraryTagNames(annot.key),
      getState: () => this.#store.getState(),
      setSelectedAttachmentKey: (key) =>
        this.#store.setState({ selectedAttachmentKey: key }),
      toggleSelectedTag: (tag) =>
        this.#store.setState({
          selectedTags: toggledTags(this.#store.getState().selectedTags, tag),
        }),
      refresh: async () => {
        const attachmentKey = this.#store.getState().selectedAttachmentKey;
        if (attachmentKey === null) return;
        await this.#deps.annotations.refresh(attachmentKey);
        await this.#reading;
        if (this.#store.getState().selectedAttachmentKey === attachmentKey)
          this.#deps.excerptDisplay.refresh();
      },
      noteFeature: this.#deps.noteFeature,
      onSetFollowMode: (mode) => this.#setFollowMode(mode),
      onPinCurrentItem: () => this.#pinCurrentItem(),
      onPinItem: () => this.#pickItemToPin(),
      onUnpin: () => this.#unpin(),
      onEnableLiveUpdates: () => this.#enableLiveUpdates(),
      onAllowEditing: () => this.#deps.allowEditing(),
      onSelectAnnotation: (annot, gesture) =>
        this.#clickFromView({ kind: gesture, key: annot.key }),
      onClearSelection: () => void this.#clearFromView(),
      selectAlone: (annot) => this.#selectAloneFromView(annot.key),
      closeEditors: () => void this.#closeEditors(),
      onDragStart: drag,
      insertAnnotation: (annotation) => {
        void insert(annotation);
      },
      renderComment: createCommentRenderer({
        app: this.#deps.app,
        component: this,
        getSourcePath: () => this.#sourcePath(),
      }),
      onExploreAnnotation: (annotationKey) => {
        if (!this.#itemKey) return;
        void openTemplateDataExplorer(this.#deps.app, {
          itemIndexedKey: this.#itemKey,
          anchorAnnotationKey: annotationKey,
        });
      },
    });

    this.#store.setState({
      liveUpdatesOn: this.#deps.liveUpdate.available,
      zoteroReaderClosed: this.#deps.liveUpdate.readerClosed,
      capability: this.#deps.annotations.capability,
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <AppContext value={this.app}>
        <AnnotStoreProvider value={this.#store}>
          <AnnotActionsContext value={this.#actions}>
            <AnnotView />
          </AnnotActionsContext>
        </AnnotStoreProvider>
      </AppContext>,
    );

    this.register(
      this.#deps.db.on("changed", () => {
        logger.debug("DB changed, refreshing annot view");
        this.#librariesCache = null;
        this.#zoteroReader?.refresh();
        this.#reload();
      }),
    );

    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () => {
        if (this.#deps.app.workspace.activeLeaf === this.leaf) {
          this.#refreshAnnotations();
        }
        if (this.#followMode === "active-tab") {
          this.#reload();
        }
      }),
    );

    this.register(
      this.#deps.pdfReaders.on("session-added", (filePath) => {
        if (
          this.#followMode === "active-tab" &&
          this.#deps.app.workspace.getActiveFile()?.path === filePath
        ) {
          this.#reload();
        }
      }),
    );

    const windowFocus = registerMigratingWindowEvent(
      this.containerEl,
      "focus",
      () => this.#refreshAnnotations(),
    );
    this.register(() => windowFocus[Symbol.dispose]());

    this.registerEvent(
      this.#deps.app.metadataCache.on("changed", (file) => {
        if (this.#followMode !== "active-tab") return;
        const activeFile = this.#deps.app.workspace.getActiveFile();
        if (activeFile && file.path === activeFile.path) this.#reload();
      }),
    );

    this.register(
      this.#zoteroReader.on("target-changed", () => {
        if (this.#followMode === "zotero-reader") this.#reload();
      }),
    );
    this.register(
      this.#zoteroReader.on("selection-changed", () => {
        if (this.#boundReader === this.#zoteroReader)
          this.#takeReaderSelection();
      }),
    );

    // Escape closes an open card editor, then clears the Card Selection. One
    // typed into a field goes on to the field. Otherwise Obsidian moves focus
    // to the last navigable leaf: right from the sidebar, but in the main area
    // that switches the tab away from this view, so the key stops here.
    const escape = registerKeymap(this.scope, [], "Escape", (event) => {
      if (inTextEntry(event.target)) return;
      if (this.#clearFromView()) return false;
      const { leftSplit, rightSplit } = this.#deps.app.workspace;
      const root = this.leaf.getRoot();
      if (root === leftSplit || root === rightSplit) return;
      return false;
    });
    this.register(() => escape[Symbol.dispose]());

    // ↑ and ↓ move the Card Selection to one card in list order, which reads
    // across the grid's columns row by row. A key on any other control goes on
    // to it, and so does one that moves nothing, so the list still scrolls at
    // either end; ← and → are left to Obsidian.
    for (const [key, step] of [
      ["ArrowUp", -1],
      ["ArrowDown", 1],
    ] as const) {
      const move = registerKeymap(this.scope, [], key, (event) => {
        if (!this.#onCardList(event.target)) return;
        if (this.#moveFromView(step)) return false;
      });
      this.register(() => move[Symbol.dispose]());
      // Shift extends the selection from the anchor instead.
      const extend = registerKeymap(this.scope, ["Shift"], key, (event) => {
        if (!this.#onCardList(event.target)) return;
        if (this.#extendFromView(step)) return false;
      });
      this.register(() => extend[Symbol.dispose]());
    }

    // Cmd/Ctrl+A selects every card the list shows, from anywhere in the
    // view. One typed into a field goes on to the field, which selects its own
    // text.
    const all = registerKeymap(this.scope, ["Mod"], "A", (event) => {
      if (inTextEntry(event.target)) return;
      this.#changeFromView({ kind: "all" });
      return false;
    });
    this.register(() => all[Symbol.dispose]());

    // Delete and Backspace erase every Selected Card. The Mac keyboards that
    // print "delete" on the backspace key send `Backspace`. One on any other
    // control goes on to it, so a field still deletes its own text.
    for (const key of ["Delete", "Backspace"]) {
      const erase = registerKeymap(this.scope, [], key, (event) => {
        if (!this.#onCardList(event.target)) return;
        if (this.#store.getState().cardSelection.selected.length === 0) return;
        this.#actions?.onDeleteSelection();
        return false;
      });
      this.register(() => erase[Symbol.dispose]());
    }

    // The platform's undo and redo keys, which a card answers with the
    // Annotation History of the Attachment this view shows.
    const historyKeys = mountCardHistoryKeys(
      this.scope,
      (direction) => this.stepHistory(direction),
      { isMacOS: Platform.isMacOS },
    );
    this.register(() => historyKeys[Symbol.dispose]());

    this.register(
      this.#deps.liveUpdate.on("available", (available) => {
        // The mode is the user's, so it stands: only the reason the view shows
        // in place changes with the listener.
        this.#store.setState({ liveUpdatesOn: available });
        if (this.#followMode === "zotero-reader") this.#reload();
      }),
    );

    this.register(
      this.#deps.liveUpdate.on("reader/closed", (closed) => {
        this.#store.setState({ zoteroReaderClosed: closed });
      }),
    );

    this.register(
      this.#deps.annotations.on("capability-changed", () =>
        this.#syncCapability(),
      ),
    );
    // The capability is the Attachment's, so it moves with the Attachment as
    // well as with the probe.
    this.register(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        () => {
          this.#syncCapability();
        },
      ),
    );
    // A Card Selection belongs to one Attachment; the bound reader's own
    // selection, which is of the same Attachment, applies over the clear.
    this.register(
      this.#store.subscribe(
        (s) => s.selectedAttachmentKey,
        () => {
          this.#store.setState({ cardSelection: NO_SELECTION });
          this.#takeReaderSelection();
        },
      ),
    );
    // A filter, a search, or a list that lost an Annotation drops the cards it
    // no longer shows. It only prunes: a reader selection is never applied
    // again for a card the list shows once more.
    this.register(
      this.#store.subscribe(
        (s) => visibleOrder(s),
        () => {
          // A list that is loading shows nothing yet, and hides nothing.
          if (this.#store.getState().annotations === null) return;
          const { selection, changed } = this.#setSelection({ kind: "prune" });
          // The bound Obsidian PDF view drops the marks the list now hides,
          // so its keys never act on a card the list does not show. A reader
          // selection still waiting is the reader's own, and stays. A second
          // view bound to the same PDF takes the pruned selection through
          // that reader, as two such views share one selection.
          const session = this.#boundPdfSession();
          const push =
            changed &&
            !this.#readerPending &&
            session !== null &&
            !sameKeys(session.selected, selection.selected);
          if (changed)
            logger.debug("A prune dropped hidden cards from the selection", {
              selected: selection.selected.length,
              pushed: push,
              readerPending: this.#readerPending,
              bound: session !== null,
            });
          if (push && session) this.#pushToPdf(session, selection.selected);
        },
        { equalityFn: sameKeys },
      ),
    );
    // A waiting reader selection applies once the list loads a key it names.
    this.register(
      this.#store.subscribe(
        (s) => s.annotations,
        (next, previous) => {
          if (!this.#readerPending) return;
          const before = new Set(previous?.map(({ key }) => key));
          const loaded = next?.some(
            ({ key }) =>
              !before.has(key) && this.#boundReader?.selected.includes(key),
          );
          if (loaded) this.#takeReaderSelection();
        },
      ),
    );
    // A reader selection an open editor held back applies once it closes.
    this.register(
      this.#store.subscribe(
        (s) => editorOpen(s),
        (open) => {
          if (!open && this.#readerPending) this.#takeReaderSelection();
        },
      ),
    );
    // One snapshot per Annotation: what a write left on it, its drafts, and
    // whether a complete read found it gone, which ends its editors.
    this.register(
      this.#deps.annotations.on("annotation-changed", (annotationKey) => {
        const state = this.#store.getState();
        const now = this.#deps.annotations.annotationState(annotationKey);
        const mutations = new Map(state.mutations);
        mutations.set(annotationKey, now.mutation);
        const commentDrafts = new Map(state.commentDrafts);
        if (now.commentDraft)
          commentDrafts.set(annotationKey, now.commentDraft);
        else commentDrafts.delete(annotationKey);
        const tagDrafts = new Map(state.tagDrafts);
        const ended = now.tagDraft ? undefined : tagDrafts.get(annotationKey);
        if (now.tagDraft) tagDrafts.set(annotationKey, now.tagDraft);
        else tagDrafts.delete(annotationKey);
        this.#store.setState({
          mutations,
          commentDrafts,
          tagDrafts,
          ...(ended && this.#heldList(ended.attachmentKey)),
          ...(now.gone &&
            state.editingCommentKey === annotationKey && {
              editingCommentKey: null,
            }),
          ...(now.gone &&
            state.editingTagsKey === annotationKey && { editingTagsKey: null }),
        });
      }),
    );

    await this.#deps.db.ready;
    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#closed = true;
    const editingCommentKey = this.#store.getState().editingCommentKey;
    if (editingCommentKey) {
      void this.#deps.annotations.submitComment(editingCommentKey, {
        automatic: true,
      });
    }
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#leafSession?.();
    this.#leafSession = null;
    // An open tag editor ends its session, and saves it, as it unmounts.
    this.#root?.unmount();
    this.#root = null;
    this.#actions = null;
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
    if (this.#followMode === mode) return;
    this.#commitMode({
      followMode: mode,
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: null,
    });
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
    this.#pin(pinnable);
  }

  #pickItemToPin(): void {
    void pickItem(
      {
        app: this.#deps.app,
        lookup: this.#deps.itemLookup,
        settings: this.#deps.settings,
      },
      m.annot_view_pin_placeholder(),
    ).then((hit) => {
      // The item index the picker searches excludes every child item type, so
      // a hit is always an Item a pin can name.
      // @see packages/db/src/queries/index-items.ts
      if (hit) this.#pin(hit.item.indexedKey);
    });
  }

  #pin(itemKey: string): void {
    this.#commitMode({
      followMode: "pinned",
      previousMode: unpinnedMode(this.#followMode),
      pinnedItemKey: itemKey,
    });
  }

  #unpin(): void {
    const { previousMode } = this.#store.getState();
    this.#commitMode({
      followMode: unpinnedMode(previousMode),
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: null,
    });
  }

  #commitMode(next: AnnotViewState): void {
    logger.debug("Follow mode changed by a gesture", { ...next });
    // A Follow Mode change clears the Card Selection; a reader the new mode
    // binds reports its own when the reload binds it.
    this.#readerPending = false;
    this.#store.setState({ ...next, cardSelection: NO_SELECTION });
    void this.#deps.app.workspace.requestSaveLayout();
    this.#reload();
  }

  #enableLiveUpdates(): void {
    this.#deps.settings.update({
      "server.enabled": true,
      "server.live-update": true,
    });
  }

  // #endregion

  // #region resolve + load

  #reload(): void {
    // Only Active Tab follows an open PDF's own session, so the subscription
    // stands exactly as long as that mode does.
    this.#followLeafSession(
      this.#followMode === "active-tab"
        ? (this.#deps.app.workspace.getActiveFile()?.path ?? null)
        : null,
    );
    this.#bindReader();
    if (this.#deps.db.state !== "ready") {
      this.#clearState();
      return;
    }
    this.#loadTarget(this.#resolveTarget());
  }

  #resolveTarget(): LoadTarget | null {
    const libraries = this.#getLibraries();
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
          pinnedItemKey: this.#store.getState().pinnedItemKey,
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
    const session = this.#deps.pdfReaders.sessionForPath(activeFile.path);
    if (session) {
      return session.target ? { kind: "pdf", target: session.target } : null;
    }
    const cache = this.#deps.app.metadataCache.getFileCache(activeFile);
    const itemKey = itemKeyFromFrontmatter(cache);
    return itemKey === null ? null : { kind: "note", itemKey };
  }

  /**
   * Track the open PDF's own session while the active tab is what we follow,
   * and drop the subscription as soon as it is not — a session outlives no
   * mode it does not drive.
   */
  #followLeafSession(filePath: string | null): void {
    this.#leafSession?.();
    this.#leafSession = null;
    const session = filePath && this.#deps.pdfReaders.sessionForPath(filePath);
    if (!session) return;
    const stack = new DisposableStack();
    // The cards drive this selection, so a press on them is no click-away:
    // the card's own click says what becomes selected.
    stack.defer(session.addSelectionSurface(this.contentEl));
    stack.defer(session.on("target-changed", () => this.#reload()));
    stack.defer(
      session.on("selection-changed", () => {
        if (this.#boundReader === session) this.#takeReaderSelection();
      }),
    );
    this.#leafSession = () => stack.dispose();
  }

  /** Names what one companion reader push points at, in Indexed Keys. */
  #resolveZoteroReader(pushed: ReaderTarget): ZoteroReaderResolution | null {
    if (this.#deps.db.state !== "ready") return null;
    try {
      const client = this.#deps.db.client;
      const attachment = getAttachmentByItemId(client, pushed.attachmentID);
      if (!attachment) return null;
      // The wire carries a selection as numeric ids, and this is the last
      // place they are read: the session speaks Indexed Keys from here on.
      const selected = getAnnotationsByParent(client, attachment.itemID)
        .filter((annot) => pushed.selected.includes(annot.itemID))
        .map((annot) => annot.indexedKey);
      const parent = attachment.parentItemID
        ? (getItemRefByID(client, attachment.parentItemID)?.indexedKey ?? null)
        : null;
      return {
        target: { attachmentKey: attachment.indexedKey, itemKey: parent },
        selected,
      };
    } catch (err) {
      logger.warn("Failed to name the Zotero reader's attachment", {
        attachmentID: pushed.attachmentID,
        error: err,
      });
      return null;
    }
  }

  #loadTarget(target: LoadTarget | null): void {
    if (!target) {
      this.#clearState();
      return;
    }

    const { db } = this.#deps;
    const { itemKey, lockedAttachmentKey, lock, key, libraryID, groupID } =
      target;
    // A standalone Attachment has no Item, so the Attachment itself is what
    // the attachment choice and the saved filter are remembered against.
    const memoryKey = itemKey ?? lockedAttachmentKey ?? key;
    const memoryChanged = memoryKey !== this.#memoryKey;
    this.#itemKey = itemKey;
    this.#memoryKey = memoryKey;

    // Dispose the previous load's subscriptions before any state mutation of
    // this load: `subscribeWithSelector` fires synchronously, so the reset
    // below would otherwise trigger the old save subscription (closed over
    // the previous item's key) and wipe its persisted filter.
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = new DisposableStack();

    this.#store.setState({
      ...(memoryChanged ? INITIAL_FILTER_STATE : null),
      groupID,
      itemKey,
      attachmentLock: lock,
      pinnable: itemKey,
      itemDisplay: this.#resolveItemSummary(target),
    });

    try {
      const client = db.client;
      const attachments = itemKey
        ? getAnnotViewAttachments(client, key, libraryID)
        : standaloneAttachment(client, key, libraryID);
      this.#store.setState({ attachments });

      const held = (k: string | null): string | null =>
        k !== null && attachments.some((a) => a.indexedKey === k) ? k : null;
      const saved =
        lockedAttachmentKey === null
          ? this.#loadAttachmentSelection(memoryKey)
          : null;
      const activeKey =
        held(lockedAttachmentKey) ??
        held(saved) ??
        attachments[0]?.indexedKey ??
        null;

      if (activeKey === null) {
        this.#store.setState({
          selectedAttachmentKey: null,
          annotations: null,
          annotationSource: null,
          annotationSourceScope: null,
        });
        return;
      }

      this.#store.setState({ selectedAttachmentKey: activeKey });
      this.#readAnnotations(activeKey, { restoreFilter: memoryChanged });

      this.#loadDisposables.defer(
        this.#store.subscribe(
          (s) => s.selectedAttachmentKey,
          (attachmentKey) => {
            if (attachmentKey === null) return;
            if (lockedAttachmentKey === null) {
              this.#saveAttachmentSelection(memoryKey, attachmentKey);
            }
            this.#readAnnotations(attachmentKey, { restoreFilter: false });
          },
        ),
      );

      // The repository's own event is the only word that a list was superseded;
      // a held read says nothing about an invalidation of its own.
      this.#loadDisposables.defer(
        this.#deps.annotations.on("annotations-changed", (changedKey) => {
          if (changedKey !== this.#store.getState().selectedAttachmentKey) {
            return;
          }
          // What the repository holds now, a write's Pending Proposal among
          // it, stands in the same task; the read that follows replaces it.
          const held = this.#heldList(changedKey);
          if (held) this.#store.setState(held);
          this.#readAnnotations(changedKey, { restoreFilter: false });
        }),
      );

      this.#loadDisposables.defer(
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
    } catch (err) {
      logger.warn("Failed to load annot view data", { key, error: err });
      this.#clearState();
    }
  }

  /**
   * The list the repository holds for the Attachment on screen, for an update
   * that cannot wait for the view's own re-read: a write's Pending Proposal as
   * it starts, and the drop of a tag draft, which the repository makes only
   * once the read-back stands in that list, so the draft and the chips change
   * in one update.
   */
  #heldList(
    attachmentKey: string,
  ): Pick<AnnotState, "annotations" | "annotationSource"> | null {
    if (attachmentKey !== this.#store.getState().selectedAttachmentKey) {
      return null;
    }
    const held = this.#deps.annotations.peek(attachmentKey);
    return held
      ? {
          annotations: held.value.annotations,
          annotationSource: held.value.source,
        }
      : null;
  }

  /**
   * Reads one Attachment's Annotations through the repository, so the list on
   * screen comes from whichever Annotation Source is active for it and says
   * which — the same source, and the same records, the overlay draws from.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  #readAnnotations(
    attachmentKey: string,
    { restoreFilter }: { restoreFilter: boolean },
  ): void {
    const read = ++this.#reads;
    const memoryKey = this.#memoryKey;
    const sourceScope = this.#deps.zoteroPref.dataDir;
    this.#reading = this.#deps.annotations
      .read(attachmentKey)
      .then((list) => {
        // A slower read never overwrites a later one, and a load that has
        // moved on leaves this answer where it fell. A null answer is a read
        // an invalidation cancelled; the same invalidation announces the
        // change this view re-reads on, so the list is not left waiting.
        if (
          read !== this.#reads ||
          list === null ||
          sourceScope !== this.#deps.zoteroPref.dataDir
        )
          return;
        const commentDrafts = new Map(
          list.annotations.flatMap((annotation) => {
            const draft = this.#deps.annotations.commentDraftFor(
              annotation.key,
            );
            return draft ? [[annotation.key, draft] as const] : [];
          }),
        );
        const tagDrafts = new Map(
          list.annotations.flatMap((annotation) => {
            const draft = this.#deps.annotations.tagDraftFor(annotation.key);
            return draft ? [[annotation.key, draft] as const] : [];
          }),
        );
        this.#store.setState({
          annotations: list.annotations,
          annotationSource: list.source,
          annotationSourceScope: sourceScope,
          commentDrafts,
          tagDrafts,
        });
        if (!restoreFilter || memoryKey === null) return;
        const saved = this.#loadFilterSelection(memoryKey, list.annotations);
        if (saved) {
          this.#store.setState({
            selectedColors: saved.colors,
            selectedTags: saved.tags,
          });
        }
      })
      .catch((error: unknown) => {
        if (read !== this.#reads) return;
        logger.warn("Failed to read the annotations of an attachment", {
          attachmentKey,
          error,
        });
        this.#store.setState({ annotations: [] });
      });
  }

  /** Revalidates the collection the view currently presents. */
  #refreshAnnotations(): void {
    const attachmentKey = this.#store.getState().selectedAttachmentKey;
    if (attachmentKey !== null) {
      void this.#deps.annotations.refresh(attachmentKey);
    }
  }

  /**
   * The Editing Capability the cards read: the Attachment's own, or — with
   * none on screen — the session's, which names no library.
   */
  #syncCapability(): void {
    const { selectedAttachmentKey } = this.#store.getState();
    this.#store.setState({
      capability:
        selectedAttachmentKey === null
          ? this.#deps.annotations.capability
          : this.#deps.annotations.capabilityFor(selectedAttachmentKey),
    });
  }

  /** The file inputs one record on screen resolves through ({@link savedExcerptRequest}). */
  #excerptRequest(input: {
    annotation: AnnotationRecord;
    source: AnnotationSource | null;
    sourceScope: string | null;
  }): ExcerptRequest | null {
    return savedExcerptRequest({
      ...input,
      db: this.#deps.db,
      paths: this.#deps.zoteroPref,
    });
  }

  /**
   * What one card's editing verbs may do, for the native overflow menu, which
   * is built outside React and so reads the store itself.
   */
  #cardControls(annot: AnnotationRecord): CardControls {
    const { capability, mutations } = this.#store.getState();
    return cardControls({
      capability,
      mutation: mutations.get(annot.key) ?? IDLE,
      hasComment: annot.comment !== null,
      hasTags: annot.tags.length > 0,
      now: Temporal.Now.instant(),
    });
  }

  /**
   * The identity block names the Item only where nothing else on screen does:
   * Active Tab always has the note or the PDF in front of the user.
   */
  #resolveItemSummary(target: LoadTarget): ItemSummary | null {
    if (this.#followMode === "active-tab" || target.itemKey === null) {
      return null;
    }
    try {
      const item = getItemsByKey(this.#deps.db.client, target.libraryID, [
        target.key,
      ])[0];
      if (!item || isChildItemFields(item.fields)) return null;
      return itemSummary(item, item.fields);
    } catch {
      return null;
    }
  }

  // #endregion

  /**
   * The Literature Note comment links resolve against — the loaded item's most
   * recent note. Falls back to the vault root when the item has no note yet, so
   * a relative link still resolves to something rather than failing.
   */
  #sourcePath(): string {
    if (this.#itemKey === null) return "";
    return this.#deps.noteIndex.getNotesByItemKey(this.#itemKey)[0]?.path ?? "";
  }

  // #region card selection

  /**
   * Bind the reader this Follow Mode keeps in step, and take its selection
   * when it is a new one. Two views bound to one Obsidian PDF view share a
   * selection through it.
   */
  #bindReader(): void {
    const reader = this.#followedSession();
    if (reader === this.#boundReader) return;
    logger.debug("The Card Selection binds another reader", {
      followMode: this.#followMode,
      source: reader?.source ?? null,
    });
    this.#boundReader = reader;
    this.#takeReaderSelection();
  }

  /** @returns the Card Selection after the change, and whether it moved. */
  #setSelection(change: SelectionChange): {
    selection: CardSelection;
    changed: boolean;
  } {
    const state = this.#store.getState();
    const current = state.cardSelection;
    const selection = nextCardSelection(current, visibleOrder(state), change);
    if (selection === current) return { selection, changed: false };
    this.#store.setState({ cardSelection: selection });
    return { selection, changed: true };
  }

  /**
   * The bound reader's selection replaces the Card Selection, and brings its
   * first card into view. While a card editor is open it waits, so the card
   * being edited keeps its selection; a key the list has not loaded waits for
   * the list. Each call drops what waited before it: the reader's selection
   * now is the latest.
   */
  #takeReaderSelection(): void {
    this.#readerPending = false;
    const reader = this.#boundReader;
    if (!reader) return;
    if (this.#pushing !== null && sameKeys(reader.selected, this.#pushing))
      return;
    const state = this.#store.getState();
    const keys = reader.selected;
    if (editorOpen(state)) {
      this.#readerPending = true;
      logger.debug("A reader selection waits for the card editor to close", {
        source: reader.source,
        keys: keys.length,
      });
      return;
    }
    const listed = new Set(state.annotations?.map(({ key }) => key));
    this.#readerPending = !keys.every((key) => listed.has(key));
    const { selection, changed } = this.#setSelection({
      kind: "replace",
      keys,
    });
    logger.debug("A reader selection replaced the Card Selection", {
      source: reader.source,
      keys: keys.length,
      selected: selection.selected.length,
      waitsForList: this.#readerPending,
    });
    if (changed) this.#scrollToCard(selection.selected);
  }

  /**
   * A gesture in the view changes the Card Selection, and a change saves and
   * closes an open card editor. A bound Obsidian PDF view takes the selection;
   * the Zotero Reader takes nothing from ZotLit (ADR 0036).
   *
   * @param landOn the Annotation whose Mark the PDF view lands on quietly: a
   *   Mark Landing, with no Mark Popup.
   */
  #changeFromView(change: SelectionChange, landOn?: string): CardSelection {
    this.#readerPending = false;
    const { selection, changed } = this.#setSelection(change);
    if (changed) this.#closeEditors();
    const session = this.#boundPdfSession();
    if (!session) return selection;
    if (!sameKeys(session.selected, selection.selected))
      this.#pushToPdf(session, selection.selected);
    if (landOn !== undefined) session.navigateToAnnotation(landOn);
    return selection;
  }

  /** Sends the Card Selection to the bound Obsidian PDF view. */
  #pushToPdf(session: ReaderSession, keys: readonly string[]): void {
    this.#pushing = keys;
    try {
      session.setSelectedAnnotations(keys);
    } finally {
      this.#pushing = null;
    }
  }

  /**
   * Whether a key landed on the card list itself: a card's row, the grid, or
   * the view around it with no control focused. A click on the empty list
   * leaves the focus on the body, and the key reaches this view's Scope only
   * while the view is the active leaf.
   */
  #onCardList(target: EventTarget | null): boolean {
    const node = target as Node | null;
    if (!node?.instanceOf(HTMLElement)) return false;
    if (node === this.containerEl || node === this.contentEl) return true;
    if (node === node.doc.body) return true;
    return (
      this.contentEl.contains(node) &&
      node.matches('.zt-annot-card, .annots-container, [role="grid"]')
    );
  }

  /** The Selected Cards, in list order. */
  #selectedCards(): AnnotationRecord[] {
    const { annotations, cardSelection } = this.#store.getState();
    const byKey = new Map(annotations?.map((annot) => [annot.key, annot]));
    return cardSelection.selected.flatMap((key) => byKey.get(key) ?? []);
  }

  /**
   * A click on a card: alone, or with Cmd/Ctrl or Shift held. A bound
   * Obsidian PDF view lands quietly on the mark of a card that a plain click
   * or a Cmd/Ctrl-click adds; a card that leaves, and a range, only repaint.
   */
  #clickFromView(change: Extract<SelectionChange, { kind: CardClick }>): void {
    const adds =
      change.kind === "click" ||
      (change.kind === "toggle" &&
        !this.#store.getState().cardSelection.selected.includes(change.key));
    this.#changeFromView(change, adds ? change.key : undefined);
  }

  /**
   * A card's edit control was pressed: a card not selected alone is first
   * selected alone, as a click selects it, so an editor never opens on a card
   * in a group.
   */
  #selectAloneFromView(key: string): void {
    const { selected } = this.#store.getState().cardSelection;
    if (selected.length === 1 && selected[0] === key) return;
    this.#clickFromView({ kind: "click", key });
  }

  /**
   * A key moves the Card Selection to one card, and a bound Obsidian PDF view
   * lands quietly on its mark, as a click does.
   *
   * @returns whether the selection moved; at either end of the list it stays.
   */
  #moveFromView(step: 1 | -1): boolean {
    const key = this.#stepFromView({ kind: "move", step });
    if (key === null) return false;
    this.#boundPdfSession()?.navigateToAnnotation(key);
    return true;
  }

  /**
   * Shift and a key extend the Card Selection by one card; the PDF only
   * repaints.
   *
   * @returns whether the selection moved; at either end of the list it stays.
   */
  #extendFromView(step: 1 | -1): boolean {
    return this.#stepFromView({ kind: "extend", step }) !== null;
  }

  /**
   * One keyboard step of the Card Selection. The card it ends on takes the
   * focus and comes into view.
   *
   * @returns the card it ends on, or `null` where the selection stayed.
   */
  #stepFromView(
    change: Extract<SelectionChange, { kind: "move" | "extend" }>,
  ): string | null {
    const current = this.#store.getState().cardSelection;
    const next = this.#changeFromView(change);
    const key = next.focus;
    if (next === current || key === null) return null;
    const card = this.#cardElement(key);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
    return key;
  }

  /**
   * Escape, or a click on the empty list: an open card editor closes first,
   * and with none open the selection clears — the view's own, and a bound PDF
   * view's where that holds a mark the list hides.
   *
   * @returns whether there was anything to close or clear.
   */
  #clearFromView(): boolean {
    if (this.#closeEditors()) return true;
    const selected =
      this.#store.getState().cardSelection.selected.length > 0 ||
      (this.#boundPdfSession()?.selected.length ?? 0) > 0;
    if (selected) this.#changeFromView({ kind: "clear" });
    return selected;
  }

  /**
   * Saves and closes the open card editors. The tag editor saves its session
   * as it unmounts; the comment editor's text is already the draft, which
   * this submits as its own close would.
   *
   * @returns whether one was open.
   */
  #closeEditors(): boolean {
    const state = this.#store.getState();
    if (!editorOpen(state)) return false;
    const { editingCommentKey } = state;
    if (editingCommentKey !== null) {
      void this.#deps.annotations
        .submitComment(editingCommentKey, { automatic: true })
        .then((outcome) => {
          if (outcome.kind === "failed")
            new BaseNotice(
              writeFailureMessage(outcome.failure, Temporal.Now.instant()),
            );
        });
    }
    this.#store.setState({ editingCommentKey: null, editingTagsKey: null });
    return true;
  }

  // #endregion

  /** Bring the first of these cards the list holds into view. */
  #scrollToCard(keys: readonly string[]): void {
    for (const key of keys) {
      const el = this.#cardElement(key);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }

  /** One Annotation's card, while the list shows it. */
  #cardElement(key: string): HTMLElement | null {
    const el = this.contentEl.querySelector(
      `.zt-annot-card[data-zotero-annotation-key="${key}"]`,
    );
    return el?.instanceOf(HTMLElement) ? el : null;
  }

  /**
   * Bring one Annotation's card forward and select it, from the Mark Popup in
   * the PDF reader or a notice. A card the list on screen does not hold is
   * left alone: the Follow Mode is the user's, and a reveal is not one of the
   * gestures that changes it.
   *
   * @param comment whether the card's comment editor takes the caret, which is
   *   the popup's answer to anything that needs typing.
   * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
   */
  revealAnnotation(
    annotationKey: string,
    { comment }: { comment: boolean },
  ): void {
    const held = this.#store
      .getState()
      .annotations?.some((record) => record.key === annotationKey);
    if (held !== true) return;
    this.#changeFromView({ kind: "click", key: annotationKey });
    this.#scrollToCard([annotationKey]);
    if (!comment || this.#store.getState().editingCommentKey === annotationKey)
      return;
    // One editor at a time: an open tag editor saves and closes first.
    this.#closeEditors();
    this.#store.setState({ editingCommentKey: annotationKey });
  }

  /**
   * The bound reader, while it is an Obsidian PDF view: the one reader this
   * view can select in. Zotero owns every gesture on its own reader.
   */
  #boundPdfSession(): ReaderSession | null {
    const reader = this.#boundReader;
    return reader?.source === "obsidian-pdf" ? reader : null;
  }

  /** The reader this view's Follow Mode is driven by, while one answers. */
  #followedSession(): ReaderSession | null {
    switch (this.#followMode) {
      case "active-tab": {
        const path = this.#deps.app.workspace.getActiveFile()?.path;
        return path ? this.#deps.pdfReaders.sessionForPath(path) : null;
      }
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

  /**
   * The numeric id the Zotero database holds for an Annotation, for the note
   * templates that read the database. `null` for an Annotation the Zotero
   * Local API answered before SQLite caught up — which is the whole reason the
   * cards are keyed by Indexed Key rather than by this.
   *
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  #resolveAnnotationID(indexedKey: string): number | null {
    if (this.#deps.db.state !== "ready") return null;
    try {
      const client = this.#deps.db.client;
      const library = resolveIndexedKeyLibrary(client, indexedKey);
      if (!library) return null;
      return (
        getAnnotationsByKey(client, [library.key], library.libraryID)[0]
          ?.itemID ?? null
      );
    } catch (error) {
      logger.warn("Failed to name an annotation in the Zotero database", {
        indexedKey,
        error,
      });
      return null;
    }
  }

  #getLibraries(): Library[] | null {
    if (this.#librariesCache) return this.#librariesCache;
    try {
      this.#librariesCache = getLibraries(this.#deps.db.client);
      return this.#librariesCache;
    } catch {
      return null;
    }
  }

  #clearState(): void {
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#store.setState({
      ...INITIAL_FILTER_STATE,
      itemKey: null,
      itemDisplay: null,
      attachments: null,
      selectedAttachmentKey: null,
      attachmentLock: null,
      pinnable: null,
      annotations: null,
      annotationSource: null,
      annotationSourceScope: null,
      commentDrafts: new Map(),
      editingCommentKey: null,
      tagDrafts: new Map(),
      editingTagsKey: null,
    });
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

/**
 * A standalone Attachment as a one-entry list, so the load path, the picker,
 * and the card list read the same shape whether or not an Item owns it.
 */
function standaloneAttachment(
  client: NodeDatabaseClient,
  key: string,
  libraryID: number,
): AnnotViewAttachment[] {
  const attachment = getAttachmentByKey(client, key, libraryID);
  if (!attachment) return [];
  return [
    {
      itemID: attachment.itemID,
      indexedKey: attachment.indexedKey,
      path: attachment.path,
      annotCount: getAttachmentAnnotationCount(client, attachment.itemID),
    },
  ];
}
