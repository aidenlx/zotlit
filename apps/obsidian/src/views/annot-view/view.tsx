import { ItemView } from "obsidian";
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

import { MenuContainerProvider } from "@/components/obsidian/menu-container";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import type { DatabaseService } from "@/services/database/service";
import { pickItem } from "@/services/item-lookup/search-modal";
import type { ItemLookup } from "@/services/item-lookup/service";
import type {
  LocalServerService,
  ReaderTarget,
} from "@/services/local-server/service";
import type { NoteFeature } from "@/services/note-feature";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { NoteIndex } from "@/services/note-index/service";
import type { PdfAnnotationEditor } from "@/services/pdf-annotation-editor/service";
import { ZoteroReaderSession } from "@/services/reader-session/zotero";
import type { ZoteroReaderResolution } from "@/services/reader-session/zotero";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";

import { AnnotActionsContext, createAnnotActions } from "./actions";
import type { AnnotActions } from "./actions";
import { AnnotView } from "./AnnotView";
import { createCommentRenderer } from "./comment-render";
import { createDragInsertHandler } from "./drag-insert";
import { sanitizeSavedFilter } from "./filter";
import type { SavedFilter } from "./filter";
import { buildPaneMenu } from "./pane-menu";
import { resolveLoadTarget } from "./resolve-target";
import type { ActiveLeafTarget, LoadTarget } from "./resolve-target";
import {
  AnnotStoreProvider,
  createAnnotStore,
  INITIAL_FILTER_STATE,
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
  db: Pick<DatabaseService, "state" | "client" | "on" | "ready" | "refresh">;
  liveUpdate: Pick<
    LocalServerService,
    "available" | "readerTarget" | "readerClosed" | "on"
  >;
  /** Every open Obsidian PDF view, as the Reader Session it exposes. */
  pdfReaders: Pick<PdfAnnotationEditor, "sessionForPath">;
  /**
   * The one read path for an Attachment's Annotations, so the cards and the
   * reader overlay show one Annotation Source's records rather than two.
   */
  annotations: Pick<AnnotationRepository, "read" | "on">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  noteFeature: Pick<
    NoteFeature,
    "renderAnnotation" | "renderAnnotationCitation"
  >;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  attachmentImport: Pick<AttachmentImportService, "prepare">;
  itemLookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
}

export class AnnotationView extends ItemView {
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
  /** What the attachment choice and the saved filter are remembered against. */
  #memoryKey: string | null = null;
  #itemKey: string | null = null;
  #importHandle: AttachmentImport | null = null;
  /** Note path the standing (or in-flight) import handle was prepared for. */
  #importHandlePath: string | null = null;
  /** Monotonic prepare token, so a slow prepare cannot overwrite a newer one. */
  #importHandleGen = 0;
  /** Counts the annotation reads, so a slower one never lands after a later one. */
  #reads = 0;
  #reading = Promise.resolve();

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

  /** "Refresh data" and the mode switches live here, off the toolbar row. */
  override onPaneMenu(menu: ObsidianMenu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source !== "more-options") return;
    const actions = this.#actions;
    if (!actions) return;
    buildPaneMenu(menu, { state: this.snapshot, actions });
  }

  protected override async onOpen(): Promise<void> {
    this.#zoteroReader = new ZoteroReaderSession({
      liveUpdate: this.#deps.liveUpdate,
      resolve: (target) => this.#resolveZoteroReader(target),
      navigate: (annotationKey) => this.#openInZotero(annotationKey),
    });
    this.register(() => this.#zoteroReader?.[Symbol.dispose]());

    this.#actions = createAnnotActions({
      app: this.#deps.app,
      getDataDir: () => this.#deps.zoteroPref.dataDir,
      resolveAnnotationID: (indexedKey) =>
        this.#resolveAnnotationID(indexedKey),
      refresh: () => this.#deps.db.refresh(),
      noteFeature: this.#deps.noteFeature,
      onSetFollowMode: (mode) => this.#setFollowMode(mode),
      onPinCurrentItem: () => this.#pinCurrentItem(),
      onPinItem: () => this.#pickItemToPin(),
      onUnpin: () => this.#unpin(),
      onEnableLiveUpdates: () => this.#enableLiveUpdates(),
      onDragStart: createDragInsertHandler({
        app: this.#deps.app,
        noteFeature: this.#deps.noteFeature,
        notify: (message) => void new BaseNotice(message),
        getImportHandle: () => this.#importHandle,
        resolveAnnotationID: (indexedKey) =>
          this.#resolveAnnotationID(indexedKey),
        onSettled: () => this.#syncImportHandle(),
      }),
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
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      // A menu's portal mounts into this view's own document, so a pop-out
      // window shows its menus rather than the main window showing them.
      <MenuContainerProvider value={this.contentEl.doc.body}>
        <AnnotStoreProvider value={this.#store}>
          <AnnotActionsContext value={this.#actions}>
            <AnnotView />
          </AnnotActionsContext>
        </AnnotStoreProvider>
      </MenuContainerProvider>,
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
        if (this.#followMode === "active-tab") {
          this.#reload();
          return;
        }
        // The other modes keep the same item across tab switches, so no reload
        // runs to refresh the drag-insert handle. Sync it here so it tracks
        // the note a drag would land in.
        this.#syncImportHandle();
      }),
    );

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
      this.#zoteroReader.on("selection-changed", (selected) => {
        if (this.#followMode !== "zotero-reader") return;
        this.#applySelection(selected);
      }),
    );

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

    await this.#deps.db.ready;
    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#leafSession?.();
    this.#leafSession = null;
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
    if (pinnable === null) return; // the control is disabled in place
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
    // The selection belongs to the reader the old mode followed; the new one
    // reports its own, or none.
    this.#store.setState({ ...next, selectedAnnotationKeys: [] });
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
    stack.defer(session.on("target-changed", () => this.#reload()));
    stack.defer(
      session.on("selection-changed", (selected) => {
        if (this.#followMode === "active-tab") this.#applySelection(selected);
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
      itemDisplayLabel: this.#resolveDisplayLabel(target),
    });

    this.#syncImportHandle();

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
    this.#store.setState({ annotations: null, annotationSource: null });
    this.#reading = this.#deps.annotations
      .read(attachmentKey)
      .then((list) => {
        // A slower read never overwrites a later one, and a load that has
        // moved on leaves this answer where it fell. A null answer is a read
        // an invalidation cancelled; the same invalidation announces the
        // change this view re-reads on, so the list is not left waiting.
        if (read !== this.#reads || list === null) return;
        this.#store.setState({
          annotations: list.annotations,
          annotationSource: list.source,
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

  /**
   * The identity block names the Item only where nothing else on screen does:
   * Active Tab always has the note or the PDF in front of the user.
   */
  #resolveDisplayLabel(target: LoadTarget): string | null {
    if (this.#followMode === "active-tab" || target.itemKey === null) {
      return null;
    }
    try {
      const item = getItemsByKey(this.#deps.db.client, target.libraryID, [
        target.key,
      ])[0];
      if (!item || isChildItemFields(item.fields)) return null;
      return itemSummary(item, item.fields).formatted;
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

  /** Mirror the reader's selection and bring its first card into view. */
  #applySelection(selected: readonly string[]): void {
    this.#store.setState({ selectedAnnotationKeys: selected });
    for (const key of selected) {
      const el = this.contentEl.querySelector(
        `.zt-annot-card[data-zotero-annotation-key="${key}"]`,
      );
      if (el?.instanceOf(HTMLElement)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
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
      itemDisplayLabel: null,
      attachments: null,
      selectedAttachmentKey: null,
      attachmentLock: null,
      pinnable: null,
      annotations: null,
      annotationSource: null,
      selectedAnnotationKeys: [],
    });
    this.#itemKey = null;
    this.#memoryKey = null;
    this.#dropImportHandle();
  }

  /**
   * Point the drag-insert import handle at the active note, in every follow
   * mode. The handle is the active note's, not the loaded item's, so it tracks
   * the active file rather than the load target.
   */
  #syncImportHandle(): void {
    if (this.#memoryKey === null) return;
    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (activeFile) this.#prepareImportHandle(activeFile.path);
    else this.#dropImportHandle();
  }

  #dropImportHandle(): void {
    this.#importHandleGen++;
    this.#importHandle = null;
    this.#importHandlePath = null;
    this.#syncDragTarget();
  }

  /** Mirror the handle's state into the store so cards can disable the drag. */
  #syncDragTarget(): void {
    this.#store.setState({
      dragTarget: this.#importHandle
        ? "ready"
        : this.#importHandlePath
          ? "preparing"
          : "none",
    });
  }

  /**
   * Prepare a fresh attachment-import handle for the active note so drag-insert
   * can resolve image embeds synchronously and `flush()` them on drop.
   *
   * `prepare()` is async (settings, folder probe, root canonicalization), and
   * this runs after every drag, drop-induced note change, and leaf activation
   * — including the click that starts a drag. A handle already prepared for
   * this same note keeps serving `dragstart` until the fresh one lands, so a
   * drag inside that window renders through the template instead of taking
   * the plain-text fallback. A handle for another note is dropped at once: it
   * would resolve links and copy excerpts relative to the wrong note.
   */
  #prepareImportHandle(notePath: string): void {
    const gen = ++this.#importHandleGen;
    if (this.#importHandlePath !== notePath) {
      this.#importHandle = null;
      this.#importHandlePath = notePath;
      this.#syncDragTarget();
    }
    void this.#deps.attachmentImport
      .prepare(notePath)
      .then((handle) => {
        // A newer prepare (or a drop of the handle) superseded this one.
        if (gen !== this.#importHandleGen) {
          logger.debug("Skipped stale attachment import handle", { notePath });
          return;
        }
        this.#importHandle = handle;
        this.#syncDragTarget();
      })
      .catch((error) => {
        logger.warn("Failed to prepare attachment import for drag-insert", {
          notePath,
          error,
        });
      });
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
