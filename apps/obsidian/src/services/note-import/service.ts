// Materializes Zotero Child Notes into flat Markdown mirrors on command, and
// links a Literature Note to each of its Child Notes.
import { normalizePath, stringifyYaml } from "obsidian";
import type {
  FileManager,
  MetadataCache,
  TFile,
  Vault,
  Workspace,
} from "obsidian";
import PQueue from "p-queue";

import type {
  AnnotationSources,
  Attachment,
  ChildNote,
  Item,
  Note,
  TemplateNoteLink,
} from "@zotlit/db";
import { zoteroNoteLink } from "@zotlit/db";
import {
  MAX_SEGMENT_BYTES,
  normalizeFilename,
  truncateToByteLimit,
} from "@zotlit/templates";

import { renderAnnotationSources } from "@/lib/annotation-render";
import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_LASTMOD,
  FIELD_ZOTERO_NOTE_KEY,
  stringifyInstant,
} from "@/lib/constants";
import { Effect } from "@/lib/effect";
import {
  ensureFolder,
  joinFolderPath,
  normalizeFolderPath,
} from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { processLiveText } from "@/lib/live-text";
import { getLogger } from "@/lib/log";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import { isFileExistsError } from "@/lib/vault-errors";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import { resolveOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type {
  ExcerptPreparation,
  ExcerptSummary,
  PreparedExcerpts,
} from "@/services/excerpt-image/prepare";
import { randomFilenameId } from "@/services/note-feature/filename";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { getProfileBinding } from "@/services/profile/bindings";
import type {
  ProfileBindingSettings,
  ResolvedProfile,
} from "@/services/profile/bindings";
import type { PlainProfile } from "@/services/profile/plain";
import type { PlainTemplate } from "@/services/template/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { noteAnnotationKeys, noteReferences, parseNote } from "./note-parser";

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

/** Shared per-run inputs threaded to the write of an `importNote` call. */
interface RunContext {
  /** Bound to the operation's Snapshot: every read of the run sees one database state. */
  reads: ZoteroReadsApi;
  settings: ProfileBindingSettings;
  attachmentFolderCache: Map<string, string>;
  /** Profile every note this run writes belongs to. */
  profile: ResolvedProfile;
  reportExcerpts?: (summary: ExcerptSummary) => void;
  /** The initiating batch's retained outcomes; this run's notes all share it. */
  outcomes?: ExcerptOutcomeScope;
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
  metadataCache: Pick<MetadataCache, "getFileCache">;
  workspace: Pick<Workspace, "iterateAllLeaves">;
};

interface NoteImporterDeps {
  profile: Pick<PlainProfile, "resolveProfile" | "profileOf">;
  app: ImportVaultApp;
  noteIndex: Pick<
    PlainNoteIndex,
    "getImportedNoteByNoteKey" | "getNotesByItemKey"
  >;
  template: Pick<
    PlainTemplate,
    "render" | "renderCitation" | "renderProfileAnnotation"
  >;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "baseAttachmentPath">;
  attachmentImport: Pick<AttachmentImportService, "prepare">;
  excerptImages?: ExcerptPreparation;
}

export interface ImportNoteOptions {
  /** Bound to the calling operation's Snapshot. */
  reads: ZoteroReadsApi;
  settings: ProfileBindingSettings;
  attachmentFolderCache?: Map<string, string>;
  /** Explicit overwrite target; omitted resolves by imported-note index. */
  targetFile?: TFile;
  reportExcerpts?: (summary: ExcerptSummary) => void;
  /**
   * The initiating batch's retained outcomes. Omitted, the write opens its own
   * scope for the notes it writes and releases it when they settle.
   */
  outcomes?: ExcerptOutcomeScope;
}

interface PrepareExplicitImportOptions {
  reads: ZoteroReadsApi;
  orphanProfile?: ProfileSelector;
}

export interface PreparedExplicitImport {
  source: "existing" | "parent" | "orphan";
  profile: ResolvedProfile;
  path: string;
  /** Execute the previewed import using a fresh, caller-held database lease. */
  import(note: Note, options: ImportNoteOptions): Promise<WriteOutcome>;
}

/**
 * Stateless note-import surface: explicit single-note writes via `importNote`,
 * previewed through `prepareExplicitImport`. Deps are captured once; one
 * shared `PQueue` bounds concurrent vault writes across all callers.
 */
export interface NoteImporter {
  /** Freeze the Profile and path for explicit-import confirmation without writing. */
  prepareExplicitImport(
    note: ChildNote,
    options: PrepareExplicitImportOptions,
  ): Promise<PreparedExplicitImport>;
  /**
   * Explicitly import a single note (create or overwrite). Used by the batch
   * runner and the single "Update imported note" command. Wraps the write in
   * the shared concurrency limiter and locates an existing file via the note
   * index; the import folder is minted and ensured only on the create branch.
   */
  importNote(note: Note, options: ImportNoteOptions): Promise<WriteOutcome>;
}

/** Per-factory state shared across all calls. */
type Ctx = NoteImporterDeps & { writes: PQueue };

export function createNoteImporter(deps: NoteImporterDeps): NoteImporter {
  const ctx: Ctx = {
    ...deps,
    writes: new PQueue({ concurrency: WRITE_CONCURRENCY }),
  };
  return {
    prepareExplicitImport: (note, options) =>
      prepareExplicitImport(ctx, note, options),
    importNote: (note, options) => doImportNote(ctx, note, options),
  };
}

/**
 * A Child Note's link-only template shape. Its `noteLink` links the Child
 * Note's Imported Note when one exists (matched by identity, not path) and
 * otherwise opens the note in Zotero. Rendering it reads the note index and
 * writes nothing: a Child Note becomes a file only through an import command.
 * The default alias is the live note title, so a retitled Zotero note updates
 * the link text without renaming the file.
 */
export function childNoteLink(
  deps: {
    app: Pick<ImportVaultApp, "fileManager">;
    noteIndex: Pick<PlainNoteIndex, "getImportedNoteByNoteKey">;
  },
  note: ChildNote,
  sourcePath: string,
): TemplateNoteLink {
  return {
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: (alias, subpath) => {
      const imported = deps.noteIndex.getImportedNoteByNoteKey(
        note.indexedKey,
      )[0];
      if (imported)
        return deps.app.fileManager.generateMarkdownLink(
          imported,
          sourcePath,
          subpath,
          alias ?? note.title ?? undefined,
        );
      return zoteroNoteLink(note, alias);
    },
  };
}

async function doImportNote(
  ctx: Ctx,
  note: Note,
  options: ImportNoteOptions,
): Promise<WriteOutcome> {
  return ctx.writes.add(async () => {
    const { existing, profile } = await explicitImportTarget(
      ctx,
      note,
      options,
    );
    await using stack = new AsyncDisposableStack();
    const run: RunContext = {
      reads: options.reads,
      settings: profile.settings,
      attachmentFolderCache: options.attachmentFolderCache ?? new Map(),
      profile,
      reportExcerpts: options.reportExcerpts,
      // This write is its own initiating batch when nothing above owns a scope.
      outcomes: resolveOutcomeScope(options.outcomes, stack),
    };

    if (existing) {
      // Awaited inside the scope: returning the pending write would release
      // the batch's retention before the write resolved its excerpts.
      return await writeNote(ctx, note, {
        mode: { action: "overwrite", file: existing },
        run,
      });
    }
    const folder = await ensureImportFolder(
      ctx.app,
      getProfileBinding(run.settings, "note.import-folder"),
    );
    return await writeNote(ctx, note, {
      mode: { action: "create", path: mintImportPath(ctx.app, folder, note) },
      run,
    });
  });
}

async function prepareExplicitImport(
  ctx: Ctx,
  note: ChildNote,
  options: PrepareExplicitImportOptions,
): Promise<PreparedExplicitImport> {
  const { existing, profile, source, sourcePath } = await explicitImportTarget(
    ctx,
    note,
    options,
  );
  const { orphanProfile } = options;
  const path =
    existing?.path ??
    mintImportPath(
      ctx.app,
      getProfileBinding(profile.settings, "note.import-folder"),
      note,
    );
  logger.debug("Prepared explicit note import", {
    indexedKey: note.indexedKey,
    path,
    profile: profile.selector,
  });
  return {
    source,
    profile,
    path,
    import: (current, runOptions) =>
      ctx.writes.add(async () => {
        const target = await explicitImportTarget(ctx, current, {
          reads: runOptions.reads,
          orphanProfile,
        });
        if (
          target.source !== source ||
          target.sourcePath !== sourcePath ||
          target.profile.selector !== profile.selector
        ) {
          logger.debug("Explicit note import source changed; skipped", {
            indexedKey: current.indexedKey,
            path,
            source,
            currentSource: target.source,
            profile: profile.selector,
            currentProfile: target.profile.selector,
          });
          return "skipped";
        }
        if (!existing)
          await ensureImportFolder(
            ctx.app,
            getProfileBinding(profile.settings, "note.import-folder"),
          );
        await using stack = new AsyncDisposableStack();
        // Awaited inside the scope: returning the pending write would release
        // the batch's retention before the write resolved its excerpts.
        return await writeNote(ctx, current, {
          mode: existing
            ? { action: "overwrite", file: existing }
            : { action: "create", path },
          run: {
            reads: runOptions.reads,
            settings: profile.settings,
            attachmentFolderCache:
              runOptions.attachmentFolderCache ?? new Map(),
            profile,
            reportExcerpts: runOptions.reportExcerpts,
            // This write is its own initiating batch when nothing above owns it.
            outcomes: resolveOutcomeScope(runOptions.outcomes, stack),
          },
        });
      }),
  };
}

async function explicitImportTarget(
  ctx: Ctx,
  note: ChildNote,
  options: PrepareExplicitImportOptions & { targetFile?: TFile },
) {
  const existing =
    (options.targetFile
      ? ctx.app.vault.getFileByPath(options.targetFile.path)
      : null) ?? ctx.noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];
  const file = existing ?? (await parentLiteratureNote(ctx, note, options));
  const source: PreparedExplicitImport["source"] = existing
    ? "existing"
    : file
      ? "parent"
      : "orphan";
  if (!file && options.orphanProfile !== undefined) {
    const profile = ctx.profile.resolveProfile(options.orphanProfile);
    if (!profile)
      throw new NoteImportProfileError(options.orphanProfile, {
        indexedKey: note.indexedKey,
      });
    return { existing, profile, source, sourcePath: undefined };
  }
  const resolved = ctx.profile.profileOf(file);
  if (!resolved.ok)
    throw new NoteImportProfileError(resolved.stamped.stamp, {
      path: file?.path,
      indexedKey: note.indexedKey,
      imported: existing !== undefined,
    });
  return {
    existing,
    profile: resolved.profile,
    source,
    sourcePath: file?.path,
  };
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
  let excerpts: PreparedExcerpts | undefined;
  if (note.note) {
    const batch = await ctx.attachmentImport.prepare(path, {
      folderCache: run.attachmentFolderCache,
    });
    attachmentBatch = batch;
    const templateMode = getProfileBinding(
      run.settings,
      "note.import-annotations-as-template",
    );
    const inputs = await readParseInputs(run.reads, note, {
      html: note.note,
      annotations: templateMode,
    });
    const annotations = ctx.excerptImages
      ? inputs.annotations?.annotations
      : undefined;
    if (annotations?.length) {
      excerpts = ctx.excerptImages!({
        reads: run.reads,
        notePath: path,
        settings: run.profile.settings,
        previousNote: mode.action === "overwrite" ? mode.file : undefined,
        outcomes: run.outcomes,
      });
      for (const annotation of annotations)
        excerpts.annotationImageLink(annotation);
      await excerpts.prepare();
    }
    const sources = inputs.annotations;
    // The prepass asks for the paragraphs `noteAnnotationKeys` selected, so
    // the sources already hold every annotation it renders.
    const renderAnnotationParagraph = sources
      ? () =>
          renderAnnotationSources(sources, {
            template: ctx.template,
            zoteroPref: ctx.zoteroPref,
            attachmentImport: batch,
            annotationImageLink: excerpts?.annotationImageLink,
            renderAnnotation: (data) =>
              ctx.template.renderProfileAnnotation(data, {
                profile: run.profile,
              }),
          })
      : undefined;
    body = parseNote(TurndownService, note.note, {
      citedItems: inputs.citedItems,
      groupID: note.groupID,
      attachments: inputs.attachments,
      renderCite: (items) => ctx.template.renderCitation(items, "main"),
      pathContext: {
        dataDir: ctx.zoteroPref.dataDir,
        baseAttachmentPath: ctx.zoteroPref.baseAttachmentPath,
      },
      useColoredHighlightSyntax: getProfileBinding(
        run.settings,
        "note.import-colored-highlights",
      ),
      highlightMappings: run.settings["note.import-highlight-mappings"],
      attachmentImport: batch,
      renderAnnotationParagraph,
    });
  }

  const frontmatter = {
    date: stringifyInstant(note.dateAdded),
    [FIELD_ZOTERO_NOTE_KEY]: note.indexedKey,
    [FIELD_ZOTERO_LASTMOD]: stringifyInstant(note.dateModified),
    ...(run.profile.stamp === undefined
      ? {}
      : { [FIELD_LITERATURE_NOTE_PROFILE]: run.profile.stamp }),
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
    await processLiveText(ctx.app, mode.file, () => content);
    outcome = "overwritten";
  }

  if (excerpts) run.reportExcerpts?.(excerpts.summary());
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

/** The parent Literature Note an explicitly created note inherits its Profile from. */
async function parentLiteratureNote(
  ctx: Ctx,
  note: ChildNote,
  options: Pick<ImportNoteOptions, "reads">,
): Promise<TFile | undefined> {
  if (note.parentItemID === null) return undefined;
  const parent = await Effect.runPromise(
    readDisplayRef(options.reads, note.parentItemID),
  );
  if (!parent) return undefined;
  return ctx.noteIndex.getNotesByItemKey(parent.indexedKey)[0];
}

/** The rows {@link parseNote} and the annotation prepass read for one note. */
interface ParseInputs {
  citedItems: ReadonlyMap<string, Item>;
  attachments: ReadonlyMap<string, Attachment>;
  /** Set when the note's annotation paragraphs render through the template. */
  annotations?: AnnotationSources;
}

const NO_ANNOTATIONS: AnnotationSources = {
  annotations: [],
  attachments: [],
  parentItems: [],
  tagsByItemID: new Map(),
  username: null,
};

/** Read every row the conversion of `html` needs, before the synchronous parse. */
async function readParseInputs(
  reads: ZoteroReadsApi,
  note: Pick<Note, "libraryID" | "groupID">,
  options: { html: string; annotations: boolean },
): Promise<ParseInputs> {
  const { html } = options;
  const { citedIndexedKeys, attachmentKeys } = noteReferences(
    html,
    note.groupID,
  );
  const annotationKeys = options.annotations ? noteAnnotationKeys(html) : [];
  const [citedItems, attachments, annotations] = await Effect.runPromise(
    Effect.all(
      [
        citedIndexedKeys.length > 0
          ? reads.ItemsByIndexedKeys({ indexedKeys: citedIndexedKeys })
          : Effect.succeed(new Map<string, Item>()),
        attachmentKeys.length > 0
          ? reads.AttachmentsByKeys({
              libraryID: note.libraryID,
              keys: attachmentKeys,
            })
          : Effect.succeed([]),
        annotationKeys.length > 0
          ? reads.AnnotationSources({
              libraryID: note.libraryID,
              keys: annotationKeys,
            })
          : Effect.succeed(options.annotations ? NO_ANNOTATIONS : undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );
  return {
    citedItems,
    attachments: new Map(attachments.map((a) => [a.key, a])),
    ...(annotations && { annotations }),
  };
}

export class NoteImportProfileError extends Error {
  readonly diagnostic: UnknownProfileDiagnostic;
  readonly imported: boolean;

  constructor(
    stamp: string,
    context: { path?: string; indexedKey?: string; imported?: boolean },
  ) {
    const { imported = true, ...diagnosticContext } = context;
    const diagnostic = unknownProfileDiagnostic(stamp, diagnosticContext);
    super(
      imported
        ? m.notice_imported_note_profile_unknown({
            stamp,
            target: context.path ?? context.indexedKey ?? stamp,
          })
        : m.notice_literature_note_profile_unknown({ stamp }),
    );
    this.name = "NoteImportProfileError";
    this.diagnostic = diagnostic;
    this.imported = imported;
  }
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
