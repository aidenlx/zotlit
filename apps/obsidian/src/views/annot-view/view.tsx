import { ItemView } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  getAnnotViewAnnotations,
  getAnnotViewAttachments,
  getItemDisplayInfoByID,
  getItemRefByID,
  getItemsByKey,
  getLibraries,
  isChildItemFields,
  parseIndexedKey,
} from "@zotlit/db";
import type { AnnotViewItem, Item, ItemRef, Library } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import type { DatabaseService } from "@/services/database/service";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { LiveUpdateService } from "@/services/live-update/service";
import type { NoteFeature } from "@/services/note-feature";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { NoteIndex } from "@/services/note-index/service";
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
import { pickItem } from "./item-picker";
import { resolveLibraryID, resolveLoadTarget } from "./resolve-target";
import type { LoadTarget } from "./resolve-target";
import {
  AnnotStoreProvider,
  createAnnotStore,
  INITIAL_FILTER_STATE,
} from "./store";
import type { FollowMode } from "./store";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const logger = getLogger(["views", "annot-view"]);

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";
const FILTER_STORAGE_KEY_PREFIX = "zotlit-annot-filter-";

/**
 * Every member is a structural `Pick` of the full service sized to what the view
 * touches, so the real services satisfy it as-is and target-resolution logic can
 * be unit-tested against plain stubs. DB reads run synchronously within one tick
 * (no `await` boundary a refresh swap could interleave with), matching the
 * house sync-read pattern (`protocol`, `citekey-editor`).
 */
export interface AnnotViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "on" | "ready" | "refresh">;
  liveUpdate: Pick<LiveUpdateService, "available" | "readerTarget" | "on">;
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
  #groupID: number | null = null;
  #librariesCache: Library[] | null = null;
  #loadDisposables: DisposableStack | null = null;
  #itemKey: string | null = null;
  #importHandle: AttachmentImport | null = null;
  /** Note path the standing (or in-flight) import handle was prepared for. */
  #importHandlePath: string | null = null;
  /** Monotonic prepare token, so a slow prepare cannot overwrite a newer one. */
  #importHandleGen = 0;

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
    const s = this.#store.getState();
    const state: Record<string, unknown> = {
      followMode: s.followMode,
    };
    if (s.linked) {
      state.linkedIndexedKey = s.linked.target.indexedKey;
    }
    return state;
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const s = state as Record<string, unknown>;

    const followMode = s.followMode;
    if (
      followMode === "note" ||
      followMode === "reader" ||
      followMode === "linked"
    ) {
      if (followMode === "reader" && !this.#deps.liveUpdate.available) {
        this.#store.setState({ followMode: "note" });
      } else if (
        followMode === "linked" &&
        typeof s.linkedIndexedKey === "string"
      ) {
        this.#restoreLinkedTarget(s.linkedIndexedKey);
      } else {
        this.#store.setState({ followMode });
      }
    }

    this.#reload();
  }

  protected override async onOpen(): Promise<void> {
    this.#actions = createAnnotActions({
      app: this.#deps.app,
      getGroupID: () => this.#groupID,
      getDataDir: () => this.#deps.zoteroPref.dataDir,
      refresh: () => this.#deps.db.refresh(),
      noteFeature: this.#deps.noteFeature,
      onToggleFollowReader: () => this.#toggleFollowReader(),
      onLinkItem: () => this.#linkItem(),
      onUnlinkItem: () => this.#setFollowMode("note"),
      onDragStart: createDragInsertHandler({
        workspace: this.#deps.app.workspace,
        noteFeature: this.#deps.noteFeature,
        getImportHandle: () => this.#importHandle,
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
      serverAvailable: this.#deps.liveUpdate.available,
      readerTarget: this.#deps.liveUpdate.readerTarget,
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <AnnotStoreProvider value={this.#store}>
        <AnnotActionsContext value={this.#actions}>
          <AnnotView />
        </AnnotActionsContext>
      </AnnotStoreProvider>,
    );

    this.register(
      this.#deps.db.on("changed", () => {
        logger.debug("DB changed, refreshing annot view");
        this.#librariesCache = null;
        this.#reload();
      }),
    );

    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () => {
        if (this.#followMode === "note") {
          this.#reload();
          return;
        }
        // Reader- and linked-follow keep the same item across note switches,
        // so no reload runs to refresh the drag-insert handle. Sync it here so
        // it tracks the note a drag would land in.
        this.#syncImportHandle();
      }),
    );

    this.registerEvent(
      this.#deps.app.metadataCache.on("changed", (file) => {
        if (this.#followMode !== "note") return;
        const activeFile = this.#deps.app.workspace.getActiveFile();
        if (activeFile && file.path === activeFile.path) this.#reload();
      }),
    );

    this.register(
      this.#deps.liveUpdate.on("reader/target", (target) => {
        const prev = this.#store.getState().readerTarget;
        this.#store.setState({ readerTarget: target });
        logger.debug("Reader target changed", {
          itemID: target.itemID,
          attachmentID: target.attachmentID,
        });
        if (this.#followMode !== "reader") return;
        // A new attachment needs a full reload; a re-select only re-highlights.
        if (target.attachmentID !== prev?.attachmentID) this.#reload();
        else this.#scrollToSelected(target.selected);
      }),
    );

    this.register(
      this.#deps.liveUpdate.on("available", (available) => {
        this.#store.setState({ serverAvailable: available });
        if (!available && this.#followMode === "reader") {
          logger.debug("Server unavailable, leaving reader-follow mode");
          this.#setFollowMode("note");
        }
      }),
    );

    await this.#deps.db.ready;
    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#root?.unmount();
    this.#root = null;
    this.#actions = null;
  }

  // #region follow mode

  #toggleFollowReader(): void {
    if (this.#followMode === "reader") {
      this.#setFollowMode("note");
      return;
    }
    if (!this.#deps.liveUpdate.available) return; // also gated in the UI
    this.#setFollowMode("reader");
  }

  #linkItem(): void {
    void pickItem({
      app: this.#deps.app,
      lookup: this.#deps.itemLookup,
      settings: this.#deps.settings,
    }).then((hit) => {
      if (!hit) return;
      const { item } = hit;
      this.#setLinkedItem(item);
      this.#reload();
    });
  }

  #restoreLinkedTarget(indexedKey: string): void {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) {
      this.#store.setState({ followMode: "note" });
      return;
    }
    const libraryID = resolveLibraryID(parsed.groupID, this.#getLibraries());
    if (libraryID === null) {
      this.#store.setState({ followMode: "note" });
      return;
    }
    try {
      const item = getItemsByKey(this.#deps.db.client, libraryID, [
        parsed.key,
      ])[0];
      if (!item) {
        this.#store.setState({ followMode: "note" });
        return;
      }
      this.#setLinkedItem(item);
    } catch {
      this.#store.setState({ followMode: "note" });
    }
  }

  #setLinkedItem(item: Item): void {
    if (isChildItemFields(item.fields)) return;

    const summary = itemSummary(item, item.fields);
    this.#store.setState({
      followMode: "linked",
      linked: {
        target: {
          itemID: item.itemID,
          key: item.key,
          libraryID: item.libraryID,
          groupID: item.groupID,
          indexedKey: item.indexedKey,
        },
        displayLabel: summary.formatted,
      },
    });
  }

  #setFollowMode(mode: FollowMode): void {
    if (this.#followMode === mode) return;
    this.#store.setState({ followMode: mode });
    this.#reload();
  }

  #resolveDisplayLabel(): string | null {
    switch (this.#followMode) {
      case "note":
        return null;
      case "reader": {
        const readerTarget = this.#deps.liveUpdate.readerTarget;
        if (!readerTarget) return null;
        try {
          const info = getItemDisplayInfoByID(
            this.#deps.db.client,
            readerTarget.itemID,
          );
          if (!info) return null;
          const summary = itemSummary(info, info.fields);
          return summary.formatted;
        } catch {
          return null;
        }
      }
      case "linked":
        return this.#store.getState().linked?.displayLabel ?? null;
    }
  }

  // #endregion

  // #region resolve + load

  #reload(): void {
    if (this.#deps.db.state !== "ready") {
      this.#clearState();
      return;
    }
    this.#loadTarget(this.#resolveTarget());
  }

  #resolveTarget(): LoadTarget | null {
    const mode = this.#followMode;
    switch (mode) {
      case "note": {
        const activeFile = this.#deps.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const cache = this.#deps.app.metadataCache.getFileCache(activeFile);
        const indexedKey = itemKeyFromFrontmatter(cache);
        const target = resolveLoadTarget({
          mode,
          indexedKey,
          libraries: this.#getLibraries(),
        });
        // Warn only when a well-formed key can't map to a library; a malformed
        // key is silent (parseIndexedKey rejects it), matching prior behavior.
        if (indexedKey && !target) {
          const parsed = parseIndexedKey(indexedKey);
          if (parsed) {
            logger.warn("Could not resolve library for group {groupID}", {
              groupID: parsed.groupID,
            });
          }
        }
        return target;
      }
      case "reader": {
        const readerTarget = this.#deps.liveUpdate.readerTarget;
        return resolveLoadTarget({
          mode,
          ref: readerTarget
            ? this.#resolveReaderRef(readerTarget.itemID)
            : null,
          attachmentID: readerTarget?.attachmentID ?? null,
        });
      }
      case "linked":
        return resolveLoadTarget({
          mode,
          linkedTarget: this.#store.getState().linked?.target ?? null,
        });
    }
  }

  #resolveReaderRef(itemID: number): ItemRef | null {
    try {
      return getItemRefByID(this.#deps.db.client, itemID);
    } catch (err) {
      logger.warn("Failed to resolve reader item {itemID}", {
        itemID,
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
    const { indexedKey, key, libraryID, groupID, boundAttachmentID } = target;

    const itemChanged = indexedKey !== this.#itemKey;
    this.#groupID = groupID;
    this.#itemKey = indexedKey;

    // Dispose the previous load's subscriptions before any state mutation of
    // this load: `subscribeWithSelector` fires synchronously, so the reset
    // below would otherwise trigger the old save subscription (closed over
    // the previous item's indexedKey) and wipe its persisted filter.
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = new DisposableStack();

    this.#store.setState({
      ...(itemChanged ? INITIAL_FILTER_STATE : null),
      groupID,
      itemKey: indexedKey,
      itemDisplayLabel: this.#resolveDisplayLabel(),
    });

    this.#syncImportHandle();

    try {
      const client = db.client;
      const attachments = getAnnotViewAttachments(client, key, libraryID);
      this.#store.setState({ attachments });

      const valid = (id: number | null): number | null =>
        id !== null && attachments.some((a) => a.itemID === id) ? id : null;
      const saved =
        boundAttachmentID !== null
          ? null
          : this.#loadAttachmentSelection(indexedKey);
      const activeAtchID =
        valid(boundAttachmentID) ??
        valid(saved) ??
        attachments[0]?.itemID ??
        null;

      if (activeAtchID === null) {
        this.#store.setState({
          selectedAttachmentID: null,
          annotations: null,
        });
        return;
      }

      this.#store.setState({ selectedAttachmentID: activeAtchID });
      const initialAnnotations = getAnnotViewAnnotations(client, activeAtchID);
      this.#store.setState({ annotations: initialAnnotations });

      if (itemChanged) {
        const savedFilter = this.#loadFilterSelection(
          indexedKey,
          initialAnnotations,
        );
        if (savedFilter) {
          this.#store.setState({
            selectedColors: savedFilter.colors,
            selectedTagIDs: savedFilter.tagIDs,
          });
        }
      }

      this.#loadDisposables.defer(
        this.#store.subscribe(
          (s) => s.selectedAttachmentID,
          (atchID) => {
            if (atchID === null) return;
            if (boundAttachmentID === null) {
              this.#saveAttachmentSelection(indexedKey, atchID);
            }
            try {
              this.#store.setState({
                annotations: getAnnotViewAnnotations(db.client, atchID),
              });
            } catch (err) {
              logger.warn(
                "Failed to load annotations for attachment {atchID}",
                { atchID, error: err },
              );
            }
          },
        ),
      );

      this.#loadDisposables.defer(
        this.#store.subscribe(
          (s) => [s.selectedColors, s.selectedTagIDs] as const,
          ([colors, tagIDs]) =>
            this.#saveFilterSelection(indexedKey, { colors, tagIDs }),
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

  /** Scroll the first card for the annotations selected in Zotero into view. */
  #scrollToSelected(selected: readonly number[]): void {
    for (const id of selected) {
      const el = this.contentEl.querySelector(
        `.zt-annot-card[data-id="${id}"]`,
      );
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
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
      selectedAttachmentID: null,
      annotations: null,
    });
    this.#groupID = null;
    this.#itemKey = null;
    this.#dropImportHandle();
  }

  /**
   * Point the drag-insert import handle at the active note, in every follow
   * mode. The handle is the active note's, not the loaded item's, so it tracks
   * the active file rather than the load target.
   */
  #syncImportHandle(): void {
    if (this.#itemKey === null) return;
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

  #loadAttachmentSelection(indexedKey: string): number | null {
    const raw = this.#deps.app.loadLocalStorage(
      STORAGE_KEY_PREFIX + indexedKey,
    );
    if (typeof raw === "string") {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  #saveAttachmentSelection(indexedKey: string, atchID: number): void {
    this.#deps.app.saveLocalStorage(
      STORAGE_KEY_PREFIX + indexedKey,
      String(atchID),
    );
  }

  #loadFilterSelection(
    indexedKey: string,
    annots: readonly AnnotViewItem[],
  ): SavedFilter | null {
    const raw = this.#deps.app.loadLocalStorage(
      FILTER_STORAGE_KEY_PREFIX + indexedKey,
    );
    return sanitizeSavedFilter(raw, annots);
  }

  #saveFilterSelection(indexedKey: string, filter: SavedFilter): void {
    const { colors, tagIDs } = filter;
    const key = FILTER_STORAGE_KEY_PREFIX + indexedKey;
    if (colors.length === 0 && tagIDs.length === 0) {
      this.#deps.app.saveLocalStorage(key, null);
      return;
    }
    this.#deps.app.saveLocalStorage(
      key,
      JSON.stringify({ colors, tags: tagIDs }),
    );
  }
}
