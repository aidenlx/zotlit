import { type App, ItemView, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import {
  getAnnotViewAnnotations,
  getAnnotViewAttachments,
  getLibraries,
  parseIndexedKey,
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
import { type NoteFeatures } from "@/services/note-feature/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  AnnotActionsContext,
  createAnnotActions,
  type AnnotActions,
} from "./actions";
import { AnnotView } from "./AnnotView";
import { createDragInsertHandler } from "./drag-insert";
import { AnnotStoreProvider, createAnnotStore } from "./store";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

const logger = getLogger(["views", "annot-view"]);

const STORAGE_KEY_PREFIX = "zotlit-annot-atch-";

export interface AnnotViewDeps {
  app: App;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  noteFeatures: NoteFeatures;
  attachmentImport: AttachmentImportService;
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

  protected override async onOpen(): Promise<void> {
    this.#actions = createAnnotActions({
      app: this.#deps.app,
      getGroupID: () => this.#groupID,
      getDataDir: () => this.#deps.zoteroPref.dataDir,
      refresh: () => this.#deps.db.refresh(),
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
        this.#resolveAndLoad();
      }),
    );

    this.registerEvent(
      this.#deps.app.workspace.on("active-leaf-change", () => {
        this.#resolveAndLoad();
      }),
    );

    this.registerEvent(
      this.#deps.app.metadataCache.on("changed", (file) => {
        const activeFile = this.#deps.app.workspace.getActiveFile();
        if (activeFile && file.path === activeFile.path) {
          this.#resolveAndLoad();
        }
      }),
    );

    await this.#deps.db.ready;
    this.#resolveAndLoad();
  }

  protected override async onClose(): Promise<void> {
    this.#loadDisposables?.[Symbol.dispose]();
    this.#loadDisposables = null;
    this.#root?.unmount();
    this.#root = null;
    this.#actions = null;
  }

  #resolveAndLoad(): void {
    const { db } = this.#deps;
    if (db.state !== "ready") {
      this.#clearState();
      return;
    }

    const activeFile = this.#deps.app.workspace.getActiveFile();
    if (!activeFile) {
      this.#clearState();
      return;
    }

    const cache = this.#deps.app.metadataCache.getFileCache(activeFile);
    const indexedKey = itemKeyFromFrontmatter(cache);
    if (!indexedKey) {
      this.#clearState();
      return;
    }

    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) {
      this.#clearState();
      return;
    }

    const { key, groupID } = parsed;
    const libraryID = this.#resolveLibraryID(groupID);
    if (libraryID === null) {
      logger.warn("Could not resolve library for group {groupID}", { groupID });
      this.#clearState();
      return;
    }

    this.#groupID = groupID;
    this.#itemKey = indexedKey;
    this.#store.setState({ groupID, itemKey: indexedKey });
    this.#prepareImportHandle(activeFile.path);

    try {
      const client = db.client;
      const attachments = getAnnotViewAttachments(client, key, libraryID);
      this.#store.setState({ attachments });

      this.#loadDisposables?.[Symbol.dispose]();
      this.#loadDisposables = new DisposableStack();

      const savedAtchID = this.#loadAttachmentSelection(indexedKey);
      if (
        savedAtchID !== null &&
        attachments.some((a) => a.itemID === savedAtchID)
      ) {
        this.#store.setState({ attachmentID: savedAtchID });
      } else if (attachments.length > 0) {
        this.#store.setState({ attachmentID: attachments[0]!.itemID });
      } else {
        this.#store.setState({ attachmentID: null, annotations: null });
        return;
      }

      const activeAtchID = this.#store.getState().attachmentID;
      if (activeAtchID !== null) {
        const annotations = getAnnotViewAnnotations(
          client,
          activeAtchID,
          libraryID,
        );
        this.#store.setState({ annotations });
      }

      this.#loadDisposables.defer(
        this.#store.subscribe(
          (s) => s.attachmentID,
          (atchID) => {
            if (atchID !== null) {
              this.#saveAttachmentSelection(indexedKey, atchID);
              try {
                const annots = getAnnotViewAnnotations(
                  db.client,
                  atchID,
                  libraryID,
                );
                this.#store.setState({ annotations: annots });
              } catch (err) {
                logger.warn(
                  "Failed to load annotations for attachment {atchID}",
                  {
                    atchID,
                    error: err,
                  },
                );
              }
            }
          },
        ),
      );

      logger.debug("Annot view loaded", {
        key,
        libraryID,
        attachments: attachments.length,
      });
    } catch (err) {
      logger.warn("Failed to load annot view data", { key, error: err });
      this.#clearState();
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
      attachments: null,
      attachmentID: null,
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
