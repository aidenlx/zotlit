// Materializes a literature note's child Zotero notes into flat Markdown mirrors.
import { normalizePath, stringifyYaml } from "obsidian";
import type { FileManager, TFile, Vault } from "obsidian";
import pLimit from "p-limit";

import {
  citekeysToCiteTemplateData,
  getAnnotationsByKey,
  getNoteByKey,
} from "@zotlit/db";
import type {
  ChildNote,
  GroupIDMemo,
  Note,
  TagMemo,
  TemplateNoteLink,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { renderAnnotations } from "@/lib/annotation-render";
import {
  FIELD_ZOTERO_LASTMOD,
  FIELD_ZOTERO_NOTE_KEY,
  stringifyInstant,
} from "@/lib/constants";
import {
  ensureFolder,
  joinFolderPath,
  normalizeFolderPath,
} from "@/lib/ensure-folder";
import { inlineCitation } from "@/lib/inline-citation";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import { isFileExistsError } from "@/lib/vault-errors";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import {
  MAX_SEGMENT_BYTES,
  normalizeFilename,
  randomFilenameId,
  truncateToByteLimit,
} from "@/services/note-feature/filename";
import type { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { parseNote } from "./note-parser";

const logger = getLogger(["note-import", "service"]);

/** Bounds concurrent `vault.create` writes across all batches. */
const WRITE_CONCURRENCY = 16;

const SUFFIX_LENGTH = 6;
/** 255 − "_" (1) − SUFFIX_LENGTH (6) − ".md" (3) = 245 */
const MAX_IMPORT_BASE_BYTES = MAX_SEGMENT_BYTES - 1 - SUFFIX_LENGTH - 3;

export type WriteOutcome = "created" | "overwritten" | "skipped";

type WriteMode =
  | { action: "create"; path: string }
  | { action: "overwrite"; file: TFile };

/** Shared per-run inputs threaded to every write in a `prepare`/`importNote` call. */
interface RunContext {
  client: NodeDatabaseClient;
  settings: Readonly<Settings>;
  groupIdMemo?: GroupIDMemo;
  tagMemo?: TagMemo;
  attachmentFolderCache: Map<string, string>;
}

interface QueuedImport {
  note: ChildNote;
  path: string;
}

/** The vault + fileManager surface the import writer touches. */
export type ImportVaultApp = {
  vault: Pick<
    Vault,
    | "getFileByPath"
    | "getRoot"
    | "getAbstractFileByPath"
    | "createFolder"
    | "create"
    | "process"
  >;
  fileManager: Pick<FileManager, "generateMarkdownLink">;
};

interface NoteImporterDeps {
  app: ImportVaultApp;
  noteIndex: Pick<NoteIndex, "getImportedNoteByNoteKey">;
  template: Pick<TemplateService, "render">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  attachmentImport: Pick<AttachmentImportService, "prepare">;
}

export interface PrepareNoteImportOptions {
  client: NodeDatabaseClient;
  /** The literature note's vault path; the link source for `noteLink`. */
  sourcePath: string;
  /** Caller-held settings snapshot (import folder and related note-import prefs). */
  settings: Readonly<Settings>;
  /** Shared across a run so group-library lookups memoize. */
  groupIdMemo?: GroupIDMemo;
  /** Shared across a run so parent-item/annotation tag lookups memoize. */
  tagMemo?: TagMemo;
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

interface ImportNoteOptions {
  client: NodeDatabaseClient;
  settings: Readonly<Settings>;
  groupIdMemo?: GroupIDMemo;
  tagMemo?: TagMemo;
  attachmentFolderCache?: Map<string, string>;
  /** Explicit overwrite target; omitted resolves by imported-note index. */
  targetFile?: TFile;
}

/**
 * Stateless note-import surface: lazy child-note batching via `prepare` and
 * explicit single-note writes via `importNote`. Deps are captured once; a
 * shared `pLimit` bounds concurrent vault writes across all callers.
 */
export interface NoteImporter {
  prepare(options: PrepareNoteImportOptions): Promise<NoteImport>;
  /**
   * Explicitly import a single note (create or overwrite). Used by the batch
   * runner and the single "Update imported note" command. Wraps the write in
   * the shared concurrency limiter and locates an existing file via the note
   * index; the import folder is minted and ensured only on the create branch.
   */
  importNote(note: Note, options: ImportNoteOptions): Promise<WriteOutcome>;
}

/** Per-factory state shared across all calls. */
type Ctx = NoteImporterDeps & {
  limit: ReturnType<typeof pLimit>;
  /**
   * Note key -> minted import path, recorded synchronously the moment a path
   * is minted (before the write lands). `ctx.noteIndex` is populated from
   * Obsidian's `metadataCache` 'changed' event, which fires asynchronously
   * after `vault.create` resolves; a second `resolveChildNote` for the same
   * note key (e.g. a double-triggered "Update in Obsidian") can otherwise run
   * before that event lands and mint a second, distinct path for one Zotero
   * note. Scoped to the whole factory instance (not a per-`prepare()` local)
   * so it spans the separate `prepare()` calls each trigger creates. Entries
   * are never evicted — once a note lands in the index the `existing` branch
   * short-circuits before this map is even consulted, so a stale entry is
   * inert, and note keys are bounded by the vault's imported notes.
   */
  pendingMints: Map<string, string>;
};

export function createNoteImporter(deps: NoteImporterDeps): NoteImporter {
  const ctx: Ctx = {
    ...deps,
    limit: pLimit(WRITE_CONCURRENCY),
    pendingMints: new Map(),
  };
  return {
    prepare: (options) => prepareImport(ctx, options),
    importNote: (note, options) => doImportNote(ctx, note, options),
  };
}

async function prepareImport(
  ctx: Ctx,
  options: PrepareNoteImportOptions,
): Promise<NoteImport> {
  const { settings, sourcePath } = options;
  const importFolder = normalizeFolderPath(
    normalizePath(settings["note.import-folder"]),
  );
  const run: RunContext = {
    client: options.client,
    settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo: options.tagMemo,
    attachmentFolderCache: new Map(),
  };
  const queue: QueuedImport[] = [];
  logger.debug("Prepared note import", { sourcePath, importFolder });
  return {
    resolveChildNote: (note) =>
      resolveChildNote(ctx, note, { sourcePath, importFolder, queue }),
    flush: () => flushQueue(ctx, queue, { importFolder, run }),
  };
}

async function doImportNote(
  ctx: Ctx,
  note: Note,
  options: ImportNoteOptions,
): Promise<WriteOutcome> {
  return ctx.limit(async () => {
    const existing =
      (options.targetFile
        ? ctx.app.vault.getFileByPath(options.targetFile.path)
        : null) ?? ctx.noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];

    const run: RunContext = {
      client: options.client,
      settings: options.settings,
      groupIdMemo: options.groupIdMemo,
      tagMemo: options.tagMemo,
      attachmentFolderCache: options.attachmentFolderCache ?? new Map(),
    };

    if (existing) {
      return writeNote(ctx, note, {
        mode: { action: "overwrite", file: existing },
        run,
      });
    }
    const folder = await ensureImportFolder(
      ctx.app,
      options.settings["note.import-folder"],
    );
    return writeNote(ctx, note, {
      mode: { action: "create", path: mintImportPath(ctx.app, folder, note) },
      run,
    });
  });
}

function resolveChildNote(
  ctx: Ctx,
  note: ChildNote,
  scope: { sourcePath: string; importFolder: string; queue: QueuedImport[] },
): TemplateNoteLink {
  const existing = ctx.noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];
  if (existing) {
    return buildNoteLink(ctx.app, note, {
      target: existing,
      sourcePath: scope.sourcePath,
    });
  }

  // Reuse a path already minted for this note key (this run or an earlier,
  // not-yet-indexed one) instead of minting a second one — see `pendingMints`.
  const pending = ctx.pendingMints.get(note.indexedKey);
  const path = pending ?? mintImportPath(ctx.app, scope.importFolder, note);
  if (!pending) ctx.pendingMints.set(note.indexedKey, path);

  let queued = false;
  return buildNoteLink(ctx.app, note, {
    target: syntheticFile(path),
    sourcePath: scope.sourcePath,
    onFirstRender: () => {
      if (!queued) {
        queued = true;
        scope.queue.push({ note, path });
      }
    },
  });
}

/**
 * A {@link TemplateNoteLink} whose `noteLink` links `target` from the lit note,
 * defaulting the alias to the live note title so a retitled Zotero note updates
 * the link text without renaming the file. `onFirstRender` (the minted path)
 * queues the import on first render — an unrendered link imports nothing.
 */
function buildNoteLink(
  app: ImportVaultApp,
  note: ChildNote,
  options: { target: TFile; sourcePath: string; onFirstRender?: () => void },
): TemplateNoteLink {
  return {
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: (alias, subpath) => {
      options.onFirstRender?.();
      return app.fileManager.generateMarkdownLink(
        options.target,
        options.sourcePath,
        subpath,
        alias ?? note.title ?? undefined,
      );
    },
  };
}

async function flushQueue(
  ctx: Ctx,
  queue: QueuedImport[],
  options: { importFolder: string; run: RunContext },
): Promise<{ created: number; skipped: number; failed: number }> {
  if (queue.length === 0) return { created: 0, skipped: 0, failed: 0 };
  await ensureImportFolder(ctx.app, options.importFolder);

  const results = await Promise.allSettled(
    queue.map((entry) =>
      ctx.limit(async () => {
        const noteData = getNoteByKey(options.run.client, entry.note.key, {
          libraryID: entry.note.libraryID,
          memo: options.run.groupIdMemo,
        });
        if (!noteData) {
          logger.warn("Imported note vanished before flush; skipped", {
            noteKey: entry.note.indexedKey,
          });
          return "skipped" as WriteOutcome;
        }
        return writeNote(ctx, noteData, {
          mode: { action: "create", path: entry.path },
          run: options.run,
        });
      }),
    ),
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failed += 1;
      logger.error("Failed to import note; siblings unaffected", {
        noteKey: queue[index]!.note.indexedKey,
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

/**
 * Write (create or overwrite) a single imported-note file from a fully-fetched
 * {@link Note}. Steps: prepare attachment batch → parse note HTML (building the
 * cite + gated annotation-template renderers here) → build frontmatter → write
 * (create or `vault.process` overwrite) → flush attachment copies.
 */
async function writeNote(
  ctx: Ctx,
  note: Note,
  { mode, run }: { mode: WriteMode; run: RunContext },
): Promise<WriteOutcome> {
  const path = mode.action === "create" ? mode.path : mode.file.path;

  let body = "";
  let attachmentBatch: AttachmentImport | undefined;
  if (note.note) {
    const batch = await ctx.attachmentImport.prepare(path, {
      folderCache: run.attachmentFolderCache,
    });
    attachmentBatch = batch;
    const renderAnnotationParagraph = run.settings[
      "note.import-annotations-as-template"
    ]
      ? (keys: readonly string[]) =>
          renderAnnotations(
            run.client,
            getAnnotationsByKey(run.client, keys, note.libraryID),
            {
              template: ctx.template,
              zoteroPref: ctx.zoteroPref,
              attachmentImport: batch,
              groupIdMemo: run.groupIdMemo,
              tagMemo: run.tagMemo,
            },
          )
      : undefined;
    body = parseNote(TurndownService, note.note, {
      client: run.client,
      libraryID: note.libraryID,
      renderCite: (items) =>
        inlineCitation(
          ctx.template.render("cite", citekeysToCiteTemplateData(items)),
        ),
      pathContext: {
        dataDir: ctx.zoteroPref.dataDir,
        baseAttachmentPath: ctx.zoteroPref.baseAttachmentPath,
      },
      useColoredHighlightSyntax: run.settings["note.import-colored-highlights"],
      attachmentImport: batch,
      renderAnnotationParagraph,
    });
  }

  const frontmatter = {
    date: stringifyInstant(note.dateAdded),
    [FIELD_ZOTERO_NOTE_KEY]: note.indexedKey,
    [FIELD_ZOTERO_LASTMOD]: stringifyInstant(note.dateModified),
  };
  const content = `---\n${stringifyYaml(frontmatter)}---\n${body}`;

  let outcome: WriteOutcome;
  if (mode.action === "create") {
    try {
      await ctx.app.vault.create(mode.path, content);
      outcome = "created";
    } catch (error) {
      if (isFileExistsError(error)) {
        logger.warn("Imported note already exists; skipped", { path });
        return "skipped";
      }
      throw error;
    }
  } else {
    await ctx.app.vault.process(mode.file, () => content);
    outcome = "overwritten";
  }

  if (attachmentBatch) {
    const copied = await attachmentBatch.flush();
    logger.debug("Imported note attachments", {
      path,
      copied: copied.copied,
      skipped: copied.skipped,
      missing: copied.missing,
    });
  }
  return outcome;
}

/**
 * Mint a unique import path for a new imported note file. The path includes a
 * random suffix to guarantee uniqueness; collisions throw
 * {@link NoteImportMintError}.
 */
function mintImportPath(
  app: ImportVaultApp,
  importFolder: string,
  note: Pick<Note, "title" | "indexedKey">,
): string {
  const folder = normalizeFolderPath(importFolder);
  const normalized = normalizeFilename(note.title ?? "");
  const base =
    normalized === ""
      ? `zotero_note_${note.indexedKey}`
      : truncateToByteLimit(normalized, MAX_IMPORT_BASE_BYTES);
  const name = `${base}_${randomFilenameId(SUFFIX_LENGTH)}.md`;
  const path = joinFolderPath(folder, name);
  if (app.vault.getAbstractFileByPath(path) !== null) {
    throw new NoteImportMintError(path);
  }
  return path;
}

/**
 * Ensure the import folder exists in the vault.
 *
 * @param importFolderSetting - raw setting value (normalized internally).
 */
async function ensureImportFolder(
  app: ImportVaultApp,
  importFolderSetting: string,
): Promise<string> {
  const folder = normalizeFolderPath(normalizePath(importFolderSetting));
  await ensureFolder(app, folder);
  return folder;
}

/**
 * Thrown when a minted import path collides with an existing vault file. The
 * 6-char suffix makes this near-impossible, so it is a hard error (no retry).
 */
export class NoteImportMintError extends Error {
  constructor(path: string) {
    super(`Imported note path collided with an existing file: ${path}`);
    this.name = "NoteImportMintError";
  }
}
