// Materializes a literature note's child Zotero notes into flat Markdown mirrors.
import { normalizePath, type App, type TFile } from "obsidian";
import pLimit, { type LimitFunction } from "p-limit";

import {
  getNoteByKey,
  type ChildNote,
  type Note,
  type TemplateNoteLink,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { normalizeFolderPath } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import { type AttachmentImportService } from "@/services/attachment-import/service";
import { type NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { type RenderAnnotationParagraph, type RenderCite } from "./note-parser";
import {
  ensureImportFolder,
  mintImportPath,
  writeImportedNoteFile,
  type WriteOutcome,
} from "./note-writer";

export { NoteImportMintError } from "./note-writer";
export type { RenderAnnotationParagraph } from "./note-parser";
export type { WriteOutcome } from "./note-writer";

const logger = getLogger(["note-import", "service"]);

/** Bounds concurrent `vault.create` writes across all batches. */
const WRITE_CONCURRENCY = 16;

export interface NoteImportServiceDeps {
  app: App;
  noteIndex: NoteIndex;
  template: TemplateService;
  zoteroPref: ZoteroPrefService;
  attachmentImport: AttachmentImportService;
}

export interface PrepareNoteImportOptions {
  client: NodeDatabaseClient;
  /** The literature note's vault path; the link source for `noteLink`. */
  sourcePath: string;
  /** Parent lit-note's group library id; scopes the identity key. */
  groupID: number | null;
  /** Parent lit-note's library id; a child note shares it. */
  libraryID: number;
  /** Annotation-template renderer; omitted leaves annotations as inline marks. */
  renderAnnotationParagraph?: RenderAnnotationParagraph;
  /** Caller-held settings snapshot (import folder and related note-import prefs). */
  settings: Readonly<Settings>;
}

export interface NoteImport {
  /**
   * Resolve a child note to its link-only template shape. An already-imported
   * note (matched by identity, not path) links to the existing file and queues
   * nothing; otherwise the path is minted and frozen now, and the import is
   * queued lazily on the link's first render (an unrendered link imports nothing).
   */
  resolveChildNote(note: ChildNote): TemplateNoteLink;
  flush(): Promise<{ created: number; skipped: number; failed: number }>;
}

export interface ImportNoteOptions {
  client: NodeDatabaseClient;
  settings: Readonly<Settings>;
  renderAnnotationParagraph?: RenderAnnotationParagraph;
  /** Explicit overwrite target; omitted resolves by imported-note index. */
  targetFile?: TFile;
  /**
   * Pre-resolved import folder.
   */
  folder: string;
}

export class NoteImportService extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #zoteroPref;
  readonly #attachmentImport;
  readonly #renderCite: RenderCite;
  readonly #limit: LimitFunction = pLimit(WRITE_CONCURRENCY);

  ready: Promise<void> = Promise.resolve();

  constructor(deps: NoteImportServiceDeps) {
    super();
    this.#app = deps.app;
    this.#noteIndex = deps.noteIndex;
    this.#zoteroPref = deps.zoteroPref;
    this.#attachmentImport = deps.attachmentImport;
    this.#renderCite = (items) => deps.template.render("cite", { items });
  }

  async prepare(options: PrepareNoteImportOptions): Promise<NoteImport> {
    const settings = options.settings;
    const importFolder = normalizePath(settings["note.import-folder"]);
    logger.debug("Prepared note import", {
      sourcePath: options.sourcePath,
      importFolder,
    });
    return new NoteImportBatch({
      app: this.#app,
      noteIndex: this.#noteIndex,
      zoteroPref: this.#zoteroPref,
      attachmentImport: this.#attachmentImport,
      limit: this.#limit,
      renderCite: this.#renderCite,
      importFolder,
      ...options,
    });
  }

  /** Ensure the import folder exists, returning its normalized path. Batch
   * callers resolve once, then pass the result via {@link ImportNoteOptions.folder}. */
  async ensureImportFolder(settings: Readonly<Settings>): Promise<string> {
    return ensureImportFolder(this.#app, settings["note.import-folder"]);
  }

  /**
   * Explicitly import a single note (create or overwrite). Used by the batch
   * runner and the single "Update imported note" command. Wraps the write in
   * the shared concurrency limiter and locates an existing file via the note
   * index.
   */
  async importNote(
    note: Note,
    options: ImportNoteOptions,
  ): Promise<WriteOutcome> {
    return this.#limit(async () => {
      const existing =
        (options.targetFile
          ? this.#app.vault.getFileByPath(options.targetFile.path)
          : null) ??
        this.#noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];

      const mode = existing
        ? ({ action: "overwrite", file: existing } as const)
        : ({
            action: "create",
            path: mintImportPath(this.#app, options.folder, note),
          } as const);

      return writeImportedNoteFile(
        {
          app: this.#app,
          client: options.client,
          zoteroPref: this.#zoteroPref,
          attachmentImport: this.#attachmentImport,
          renderCite: this.#renderCite,
          renderAnnotationParagraph: options.renderAnnotationParagraph,
        },
        note,
        mode,
      );
    });
  }
}

interface NoteImportBatchOptions extends PrepareNoteImportOptions {
  app: App;
  noteIndex: NoteIndex;
  zoteroPref: ZoteroPrefService;
  attachmentImport: AttachmentImportService;
  limit: LimitFunction;
  renderCite: RenderCite;
  importFolder: string;
}

interface QueuedImport {
  note: ChildNote;
  path: string;
}

class NoteImportBatch implements NoteImport {
  readonly #app;
  readonly #noteIndex;
  readonly #zoteroPref;
  readonly #attachmentImport;
  readonly #client;
  readonly #sourcePath;
  readonly #importFolder;
  readonly #limit;
  readonly #renderCite: RenderCite;
  readonly #renderAnnotationParagraph?: RenderAnnotationParagraph;
  readonly #queue: QueuedImport[] = [];

  constructor(options: NoteImportBatchOptions) {
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#zoteroPref = options.zoteroPref;
    this.#attachmentImport = options.attachmentImport;
    this.#client = options.client;
    this.#sourcePath = options.sourcePath;
    this.#importFolder = normalizeFolderPath(options.importFolder);
    this.#limit = options.limit;
    this.#renderCite = options.renderCite;
    this.#renderAnnotationParagraph = options.renderAnnotationParagraph;
  }

  resolveChildNote(note: ChildNote): TemplateNoteLink {
    const existing = this.#noteIndex.getImportedNoteByNoteKey(
      note.indexedKey,
    )[0];
    if (existing) {
      return this.#noteLink(note, existing);
    }

    const path = mintImportPath(this.#app, this.#importFolder, note);
    let queued = false;
    return this.#noteLink(note, syntheticFile(path), () => {
      if (!queued) {
        queued = true;
        this.#queue.push({ note, path });
      }
    });
  }

  /**
   * A {@link TemplateNoteLink} whose `noteLink` links `target` from the lit note,
   * defaulting the alias to the live note title so a retitled Zotero note updates
   * the link text without renaming the file. `onFirstRender` (the minted path)
   * queues the import on first render — an unrendered link imports nothing.
   */
  #noteLink(
    note: ChildNote,
    target: TFile,
    onFirstRender?: () => void,
  ): TemplateNoteLink {
    return {
      key: note.key,
      title: note.title,
      noteLink: (alias, subpath) => {
        onFirstRender?.();
        return this.#app.fileManager.generateMarkdownLink(
          target,
          this.#sourcePath,
          subpath,
          alias ?? note.title ?? undefined,
        );
      },
    };
  }

  async flush(): Promise<{ created: number; skipped: number; failed: number }> {
    if (this.#queue.length === 0) return { created: 0, skipped: 0, failed: 0 };
    await ensureImportFolder(this.#app, this.#importFolder);

    const results = await Promise.allSettled(
      this.#queue.map((entry) => this.#limit(() => this.#writeOne(entry))),
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed += 1;
        logger.error("Failed to import note; siblings unaffected", {
          noteKey: this.#queue[index]!.note.indexedKey,
          error: result.reason,
        });
      } else if (result.value === "created") {
        created += 1;
      } else {
        skipped += 1;
      }
    }
    logger.debug("Imported notes", { created, skipped, failed });
    return { created, skipped, failed };
  }

  async #writeOne(entry: QueuedImport): Promise<WriteOutcome> {
    const noteData = getNoteByKey(
      this.#client,
      entry.note.key,
      entry.note.libraryID,
    );
    if (!noteData) {
      logger.warn("Imported note vanished before flush; skipped", {
        noteKey: entry.note.indexedKey,
      });
      return "skipped";
    }

    return writeImportedNoteFile(
      {
        app: this.#app,
        client: this.#client,
        zoteroPref: this.#zoteroPref,
        attachmentImport: this.#attachmentImport,
        renderCite: this.#renderCite,
        renderAnnotationParagraph: this.#renderAnnotationParagraph,
      },
      noteData,
      { action: "create", path: entry.path },
    );
  }
}
