// Write-core for imported Zotero notes: shared by auto (skip-if-exists) and
// explicit (overwrite-if-exists) import paths.
import { normalizePath, stringifyYaml, type App, type TFile } from "obsidian";

import { type Note } from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { FIELD_ZOTERO_NOTE_KEY, stringifyInstant } from "@/lib/constants";
import { ensureFolder, normalizeFolderPath } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { isFileExistsError } from "@/lib/vault-errors";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import {
  normalizeFilename,
  randomFilenameId,
} from "@/services/note-feature/filename";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  parseNote,
  type NoteParserDeps,
  type RenderAnnotationParagraph,
  type RenderCite,
} from "./note-parser";

const logger = getLogger(["note-import", "note-writer"]);

const SUFFIX_LENGTH = 6;
const MAX_BASE_LENGTH = 200;

export type WriteMode =
  | { action: "create"; path: string }
  | { action: "overwrite"; file: TFile };

export type WriteOutcome = "created" | "overwritten" | "skipped";

export interface WriteImportedNoteContext {
  app: App;
  client: NodeDatabaseClient;
  zoteroPref: ZoteroPrefService;
  attachmentImport: AttachmentImportService;
  renderCite: RenderCite;
  renderAnnotationParagraph?: RenderAnnotationParagraph;
}

/**
 * Write (create or overwrite) a single imported-note file from a fully-fetched
 * {@link Note}. Shared by the auto batch ({@link NoteImportBatch}) and the
 * explicit {@link NoteImportService.importNote} path.
 *
 * Steps: prepare attachment batch → parse note HTML → build frontmatter →
 * write (create or vault.process overwrite) → flush attachment copies.
 */
export async function writeImportedNoteFile(
  ctx: WriteImportedNoteContext,
  note: Note,
  mode: WriteMode,
): Promise<WriteOutcome> {
  const path = mode.action === "create" ? mode.path : mode.file.path;

  let body = "";
  let attachmentBatch: AttachmentImport | undefined;
  if (note.note) {
    const batch = await ctx.attachmentImport.prepare(path);
    attachmentBatch = batch;
    const resolveLink: NoteParserDeps["resolveLink"] = (opts) =>
      batch.resolveLink(opts);
    const { renderAnnotationParagraph } = ctx;
    body = parseNote(TurndownService, note.note, {
      client: ctx.client,
      libraryID: note.libraryID,
      renderCite: ctx.renderCite,
      pathContext: {
        dataDir: ctx.zoteroPref.dataDir,
        baseAttachmentPath: ctx.zoteroPref.baseAttachmentPath,
      },
      resolveLink,
      renderAnnotationParagraph: renderAnnotationParagraph
        ? (keys) => renderAnnotationParagraph(keys, resolveLink)
        : undefined,
    });
  }

  const frontmatter = {
    date: stringifyInstant(note.dateAdded),
    [FIELD_ZOTERO_NOTE_KEY]: note.indexedKey,
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
export function mintImportPath(
  app: App,
  importFolder: string,
  note: Pick<Note, "title" | "indexedKey">,
): string {
  const folder = normalizeFolderPath(importFolder);
  const normalized = normalizeFilename(note.title ?? "");
  const base =
    normalized === ""
      ? `zotero_note_${note.indexedKey}`
      : normalized.slice(0, MAX_BASE_LENGTH);
  const name = `${base}_${randomFilenameId(SUFFIX_LENGTH)}.md`;
  const path = folder === "/" ? name : `${folder}/${name}`;
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
export async function ensureImportFolder(
  app: App,
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
