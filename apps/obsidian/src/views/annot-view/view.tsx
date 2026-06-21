import {
  type App,
  ItemView,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import {
  getAnnotViewAnnotations,
  getAnnotViewAttachments,
  getItemDisplayInfoByID,
  getItemRefByID,
  getItemsByKey,
  getLibraries,
  type Item,
  type ItemRef,
  itemDateYear,
  parseIndexedKey,
  parseItemDate,
  USER_LIBRARY_ID,
  type Library,
} from "@zotlit/db";

import { getLogger } from "@/lib/log";
import * as m from "@/paraglide/messages";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { type ItemLookup } from "@/services/item-lookup/service";
import { type LiveUpdateService } from "@/services/live-update/service";
import { type NoteFeatures } from "@/services/note-feature/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  AnnotActionsContext,
  createAnnotActions,
  type AnnotActions,
} from "./actions";
import { AnnotView } from "./AnnotView";
import { createDragInsertHandler } from "./drag-insert";
import { pickItem } from "./item-picker";
import { AnnotStoreProvider, createAnnotStore, type FollowMode } from "./store";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const logger = getLogger(["views", "annot-view"]);

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";

function formatDisplayLabel(
  info: {
    title?: string | null;
    creators: { lastName: string | null }[];
    year: number | null;
  },
  fallbackKey: string,
): string {
  const title = info.title || fallbackKey;
  const first = info.creators[0]?.lastName;
  let creatorText = "";
  if (first) {
    const second = info.creators[1]?.lastName ?? "";
    const count =
      info.creators.length === 1
        ? 1
        : info.creators.length === 2 && second
          ? 2
          : 3;
    creatorText = m.creator_summary({ count, first, second });
  }
  const lead = creatorText
    ? info.year !== null
      ? `${creatorText} (${info.year})`
      : creatorText
    : info.year !== null
      ? `(${info.year})`
      : null;
  return lead ? `${lead} — ${title}` : title;
}

/** A resolved item plus the attachment to prefer when first loading it. */
interface LoadTarget {
  indexedKey: string;
  key: string;
  libraryID: number;
  groupID: number | null;
  /** Reader-driven attachment; authoritative when set, falls back to saved/first when null. */
  boundAttachmentID: number | null;
}

export interface AnnotViewDeps {
  app: App;
  db: DatabaseService;
  liveUpdate: LiveUpdateService;
  zoteroPref: ZoteroPrefService;
  noteFeatures: NoteFeatures;
  attachmentImport: AttachmentImportService;
  itemLookup: ItemLookup;
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
      onToggleFollowReader: () => this.#toggleFollowReader(),
      onLinkItem: () => this.#linkItem(),
      onUnlinkItem: () => this.#setFollowMode("note"),
      onDragStart: createDragInsertHandler({
        workspace: this.#deps.app.workspace,
        noteFeatures: this.#deps.noteFeatures,
        getIndexedKey: () => this.#itemKey,
        getImportHandle: () => this.#importHandle,
        onSettled: () => {
          const activeFile = this.#deps.app.workspace.getActiveFile();
          if (this.#itemKey !== null && activeFile) {
            this.#prepareImportHandle(activeFile.path);
          }
        },
      }),
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
        if (this.#followMode === "note") this.#reload();
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
      const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;
      this.#setLinkedItem(item, groupID, item.indexedKey);
      this.#reload();
    });
  }

  #restoreLinkedTarget(indexedKey: string): void {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) {
      this.#store.setState({ followMode: "note" });
      return;
    }
    const libraryID = this.#resolveLibraryID(parsed.groupID);
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
      this.#setLinkedItem(item, parsed.groupID, indexedKey);
    } catch {
      this.#store.setState({ followMode: "note" });
    }
  }

  #setLinkedItem(item: Item, groupID: number | null, indexedKey: string): void {
    this.#store.setState({
      followMode: "linked",
      linked: {
        target: {
          itemID: item.itemID,
          key: item.key,
          libraryID: item.libraryID,
          groupID,
          indexedKey,
        },
        displayLabel: formatDisplayLabel(
          {
            title: "title" in item.fields ? item.fields.title : null,
            creators: item.creators,
            year: itemDateYear(
              parseItemDate("date" in item.fields ? item.fields.date : null),
            ),
          },
          item.key,
        ),
      },
    });
  }

  #setFollowMode(mode: FollowMode): void {
    if (this.#followMode === mode) return;
    this.#store.setState({ followMode: mode });
    this.#reload();
  }

  #resolveDisplayLabel(target: LoadTarget): string | null {
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
          return formatDisplayLabel(info, target.key);
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
    switch (this.#followMode) {
      case "note":
        return this.#resolveActiveNote();
      case "reader":
        return this.#resolveReader();
      case "linked": {
        const linked = this.#store.getState().linked;
        return linked ? { ...linked.target, boundAttachmentID: null } : null;
      }
    }
  }

  #resolveActiveNote(): LoadTarget | null {
    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (!activeFile) return null;
    const cache = this.#deps.app.metadataCache.getFileCache(activeFile);
    const indexedKey = itemKeyFromFrontmatter(cache);
    if (!indexedKey) return null;
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) return null;
    const libraryID = this.#resolveLibraryID(parsed.groupID);
    if (libraryID === null) {
      logger.warn("Could not resolve library for group {groupID}", {
        groupID: parsed.groupID,
      });
      return null;
    }
    return {
      indexedKey,
      key: parsed.key,
      libraryID,
      groupID: parsed.groupID,
      boundAttachmentID: null,
    };
  }

  #resolveReader(): LoadTarget | null {
    const target = this.#deps.liveUpdate.readerTarget;
    if (!target) return null;
    let ref: ItemRef | null;
    try {
      ref = getItemRefByID(this.#deps.db.client, target.itemID);
    } catch (err) {
      logger.warn("Failed to resolve reader item {itemID}", {
        itemID: target.itemID,
        error: err,
      });
      return null;
    }
    if (!ref) return null;
    return {
      indexedKey: ref.indexedKey,
      key: ref.key,
      libraryID: ref.libraryID,
      groupID: ref.groupID,
      boundAttachmentID: target.attachmentID,
    };
  }

  #loadTarget(target: LoadTarget | null): void {
    if (!target) {
      this.#clearState();
      return;
    }

    const { db } = this.#deps;
    const { indexedKey, key, libraryID, groupID, boundAttachmentID } = target;

    this.#groupID = groupID;
    this.#itemKey = indexedKey;
    this.#store.setState({
      groupID,
      itemKey: indexedKey,
      itemDisplayLabel: this.#resolveDisplayLabel(target),
    });

    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (activeFile) this.#prepareImportHandle(activeFile.path);
    else this.#importHandle = null;

    try {
      const client = db.client;
      const attachments = getAnnotViewAttachments(client, key, libraryID);
      this.#store.setState({ attachments });

      this.#loadDisposables?.[Symbol.dispose]();
      this.#loadDisposables = new DisposableStack();

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
      this.#store.setState({
        annotations: getAnnotViewAnnotations(client, activeAtchID, libraryID),
      });

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
                annotations: getAnnotViewAnnotations(
                  db.client,
                  atchID,
                  libraryID,
                ),
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

  #resolveLibraryID(groupID: number | null): number | null {
    if (groupID === null) return USER_LIBRARY_ID;
    const libraries = this.#getLibraries();
    if (!libraries) return null;
    const lib = libraries.find((l) => l.groupID === groupID);
    return lib?.libraryID ?? null;
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
      itemKey: null,
      itemDisplayLabel: null,
      attachments: null,
      selectedAttachmentID: null,
      annotations: null,
    });
    this.#groupID = null;
    this.#itemKey = null;
    this.#importHandle = null;
  }

  /**
   * Prepare a fresh attachment-import handle for the active note so drag-insert
   * can resolve image embeds synchronously and `flush()` them on drop. Discards
   * any prior handle (and its un-dropped pending imports).
   */
  #prepareImportHandle(notePath: string): void {
    this.#importHandle = null;
    void this.#deps.attachmentImport
      .prepare(notePath)
      .then((handle) => {
        // Ignore if the active note changed while preparing.
        if (this.#deps.app.workspace.getActiveFile()?.path === notePath) {
          this.#importHandle = handle;
        }
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
}
