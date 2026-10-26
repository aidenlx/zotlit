// Materializes Zotero Child Notes into flat Markdown mirrors on command.
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { normalizePath, stringifyYaml, TFile, TFolder } from "obsidian";

import type {
  AnnotationSources,
  Attachment,
  ChildNote,
  Item,
  Note,
} from "@zotlit/db";
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
import { processLiveText } from "@/lib/effect-live-text";
import { withLogCategory } from "@/lib/effect-log";
import { joinFolderPath, normalizeFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type { VaultError } from "@/lib/vault-errors";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type {
  ExcerptPreparation,
  ExcerptSummary,
  PreparedExcerpts,
} from "@/services/excerpt-image/prepare";
import { randomFilenameId } from "@/services/note-feature/filename";
import { NoteIndex } from "@/services/note-index/service";
import { getProfileBinding } from "@/services/profile/bindings";
import type {
  ProfileBindingSettings,
  ResolvedProfile,
} from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import {
  profileRead,
  syncTemplate,
} from "@/services/template-workbench/sync-template";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { noteAnnotationKeys, noteReferences, parseNote } from "./note-parser";

/** Bounds concurrent vault writes across all batches. */
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
  outcomes: ExcerptOutcomeScope;
}

/**
 * The legacy pieces a note write calls: Attachment Import's per-note batch and
 * the excerpt preparation. They convert in a later slice; until then
 * `build.ts` binds them once the container holds them.
 */
export interface NoteImportPorts {
  readonly attachmentImport: Pick<AttachmentImportService, "prepare">;
  readonly excerptImages?: ExcerptPreparation;
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

/**
 * What a note write fails with: the Profile it needs is unknown, its minted
 * path is taken, or a read or vault write failed. A legacy port's rejection
 * and a Template throw are defects that carry what was thrown.
 */
export type NoteImportError =
  | NoteImportProfileError
  | NoteImportMintError
  | NoteImportFolderError
  | Effect.Error<ReturnType<typeof readDisplayRef>>
  | VaultError;

export interface PreparedExplicitImport {
  source: "existing" | "parent" | "orphan";
  profile: ResolvedProfile;
  path: string;
  /** Execute the previewed import using a fresh, caller-held database lease. */
  import(
    note: Note,
    options: ImportNoteOptions,
  ): Effect.Effect<WriteOutcome, NoteImportError>;
}

/**
 * The note-import write surface: explicit single-note writes through
 * `importNote`, previewed through `prepareExplicitImport`. One semaphore
 * bounds concurrent vault writes across all callers.
 */
export class NoteImporter extends Context.Service<
  NoteImporter,
  {
    /** Freeze the Profile and path for explicit-import confirmation without writing. */
    prepareExplicitImport(
      note: ChildNote,
      options: PrepareExplicitImportOptions,
    ): Effect.Effect<PreparedExplicitImport, NoteImportError>;
    /**
     * Explicitly import a single note (create or overwrite). Used by the batch
     * runner and the single "Update imported note" command. Holds one write
     * permit for the whole write and locates an existing file via the note
     * index; the import folder is minted and ensured only on the create branch.
     */
    importNote(
      note: Note,
      options: ImportNoteOptions,
    ): Effect.Effect<WriteOutcome, NoteImportError>;
  }
>()("zotlit/obsidian/NoteImporter") {}

const logged = withLogCategory("note-import", "service");

/** The note importer over the graph's tags and the legacy `ports`. */
export const layerNoteImporter = (ports: NoteImportPorts) =>
  Layer.effect(
    NoteImporter,
    Effect.gen(function* () {
      const writes = yield* Semaphore.make(WRITE_CONCURRENCY);
      const context = yield* Effect.context<
        Profile | NoteIndex | Vault | Workspace | ZoteroPref
      >();
      const templates = yield* syncTemplate;
      const ctx: Ctx = { ports, templates };
      const run = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          Profile | NoteIndex | Vault | Workspace | ZoteroPref
        >,
      ) => Effect.provideContext(effect, context);
      return NoteImporter.of({
        prepareExplicitImport: Effect.fn("NoteImporter.prepareExplicitImport")(
          function* (note, options) {
            const prepared = yield* run(
              prepareExplicitImport(ctx, note, options),
            );
            return {
              ...prepared,
              import: (current: Note, runOptions: ImportNoteOptions) =>
                writes.withPermits(1)(
                  run(prepared.importNow(current, runOptions)),
                ),
            };
          },
        ),
        importNote: Effect.fn("NoteImporter.importNote")((note, options) =>
          writes.withPermits(1)(run(doImportNote(ctx, note, options))),
        ),
      });
    }),
  );

/** Per-layer values every write reads. */
interface Ctx {
  readonly ports: NoteImportPorts;
  readonly templates: Effect.Success<typeof syncTemplate>;
}

const doImportNote = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: Note,
  options: ImportNoteOptions,
) {
  const { existing, profile } = yield* explicitImportTarget(note, options);
  // This write is its own initiating batch when nothing above owns a scope;
  // the scope is released once the write settles.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const run: RunContext = {
        reads: options.reads,
        settings: profile.settings,
        attachmentFolderCache: options.attachmentFolderCache ?? new Map(),
        profile,
        reportExcerpts: options.reportExcerpts,
        outcomes: yield* outcomeScope(options.outcomes),
      };
      if (existing) {
        return yield* writeNote(ctx, note, {
          mode: { action: "overwrite", file: existing },
          run,
        });
      }
      const folder = yield* ensureImportFolder(
        getProfileBinding(run.settings, "note.import-folder"),
      );
      return yield* writeNote(ctx, note, {
        mode: {
          action: "create",
          path: yield* mintImportPath(folder, note),
        },
        run,
      });
    }),
  );
});

/** The batch's scope, or one this write owns until its Scope closes. */
const outcomeScope = (provided: ExcerptOutcomeScope | undefined) =>
  provided === undefined
    ? Effect.acquireDisposable(Effect.sync(() => new ExcerptOutcomeScope()))
    : Effect.succeed(provided);

const prepareExplicitImport = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: ChildNote,
  options: PrepareExplicitImportOptions,
) {
  const { existing, profile, source, sourcePath } = yield* explicitImportTarget(
    note,
    options,
  );
  const { orphanProfile } = options;
  const path =
    existing?.path ??
    (yield* mintImportPath(
      getProfileBinding(profile.settings, "note.import-folder"),
      note,
    ));
  yield* Effect.logDebug("Prepared explicit note import").pipe(
    Effect.annotateLogs({
      indexedKey: note.indexedKey,
      path,
      profile: profile.selector,
    }),
    logged,
  );
  const importNow = Effect.fnUntraced(function* (
    current: Note,
    runOptions: ImportNoteOptions,
  ) {
    const target = yield* explicitImportTarget(current, {
      reads: runOptions.reads,
      orphanProfile,
    });
    if (
      target.source !== source ||
      target.sourcePath !== sourcePath ||
      target.profile.selector !== profile.selector
    ) {
      yield* Effect.logDebug(
        "Explicit note import source changed; skipped",
      ).pipe(
        Effect.annotateLogs({
          indexedKey: current.indexedKey,
          path,
          source,
          currentSource: target.source,
          profile: profile.selector,
          currentProfile: target.profile.selector,
        }),
        logged,
      );
      const skipped: WriteOutcome = "skipped";
      return skipped;
    }
    if (!existing)
      yield* ensureImportFolder(
        getProfileBinding(profile.settings, "note.import-folder"),
      );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        return yield* writeNote(ctx, current, {
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
            outcomes: yield* outcomeScope(runOptions.outcomes),
          },
        });
      }),
    );
  });
  return { source, profile, path, importNow };
});

const explicitImportTarget = Effect.fnUntraced(function* (
  note: ChildNote,
  options: PrepareExplicitImportOptions & { targetFile?: TFile },
) {
  const vault = yield* Vault;
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  const existing =
    (options.targetFile
      ? yield* vault.getFileByPath(options.targetFile.path)
      : null) ??
    (yield* noteIndex.getImportedNoteByNoteKey(note.indexedKey))[0];
  const file = existing ?? (yield* parentLiteratureNote(note, options));
  const source: PreparedExplicitImport["source"] = existing
    ? "existing"
    : file
      ? "parent"
      : "orphan";
  if (!file && options.orphanProfile !== undefined) {
    const profile = yield* profileRead(
      profiles.resolveProfile(options.orphanProfile),
    );
    if (!profile)
      return yield* Effect.fail(
        new NoteImportProfileError(options.orphanProfile, {
          indexedKey: note.indexedKey,
        }),
      );
    return { existing, profile, source, sourcePath: undefined };
  }
  const resolved = yield* profileRead(profiles.profileOf(file));
  if (!resolved.ok)
    return yield* Effect.fail(
      new NoteImportProfileError(resolved.stamped.stamp, {
        path: file?.path,
        indexedKey: note.indexedKey,
        imported: existing !== undefined,
      }),
    );
  return {
    existing,
    profile: resolved.profile,
    source,
    sourcePath: file?.path,
  };
});

/**
 * Write (create or overwrite) a single imported-note file from a fully-fetched
 * {@link Note}. Steps: prepare attachment batch → parse note HTML (building the
 * cite + gated annotation-template renderers here) → build frontmatter → write
 * (create or live-text overwrite) → flush attachment copies.
 */
const writeNote = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: Note,
  { mode, run }: { mode: WriteMode; run: RunContext },
) {
  const path = mode.action === "create" ? mode.path : mode.file.path;

  let body = "";
  let attachmentBatch: AttachmentImport | undefined;
  let excerpts: PreparedExcerpts | undefined;
  if (note.note) {
    const html = note.note;
    const batch = yield* Effect.promise(() =>
      ctx.ports.attachmentImport.prepare(path, {
        folderCache: run.attachmentFolderCache,
      }),
    );
    attachmentBatch = batch;
    const templateMode = getProfileBinding(
      run.settings,
      "note.import-annotations-as-template",
    );
    const inputs = yield* readParseInputs(run.reads, note, {
      html,
      annotations: templateMode,
    });
    const { excerptImages } = ctx.ports;
    const annotations = excerptImages
      ? inputs.annotations?.annotations
      : undefined;
    if (excerptImages && annotations?.length) {
      const prepared = excerptImages({
        reads: run.reads,
        notePath: path,
        settings: run.profile.settings,
        previousNote: mode.action === "overwrite" ? mode.file : undefined,
        outcomes: run.outcomes,
      });
      excerpts = prepared;
      for (const annotation of annotations)
        prepared.annotationImageLink(annotation);
      yield* Effect.promise(() => prepared.prepare());
    }
    const sources = inputs.annotations;
    const { templates } = ctx;
    const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
    const zoteroPref = { dataDir, baseAttachmentPath };
    const annotationImageLink = excerpts?.annotationImageLink;
    // The prepass asks for the paragraphs `noteAnnotationKeys` selected, so
    // the sources already hold every annotation it renders.
    const renderAnnotationParagraph = sources
      ? () =>
          renderAnnotationSources(sources, {
            template: templates,
            zoteroPref,
            attachmentImport: batch,
            annotationImageLink,
            renderAnnotation: (data) =>
              templates.renderProfileAnnotation(data, {
                profile: run.profile,
              }),
          })
      : undefined;
    body = yield* Effect.sync(() =>
      parseNote(TurndownService, html, {
        citedItems: inputs.citedItems,
        groupID: note.groupID,
        attachments: inputs.attachments,
        renderCite: (items) => templates.renderCitation(items, "main"),
        pathContext: zoteroPref,
        useColoredHighlightSyntax: getProfileBinding(
          run.settings,
          "note.import-colored-highlights",
        ),
        highlightMappings: run.settings["note.import-highlight-mappings"],
        attachmentImport: batch,
        renderAnnotationParagraph,
      }),
    );
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
    const created = yield* (yield* Vault).create(mode.path, content).pipe(
      Effect.as(true),
      Effect.catchTag("FileExists", () => Effect.succeed(false)),
    );
    if (!created) {
      yield* Effect.logWarning("Imported note already exists; skipped").pipe(
        Effect.annotateLogs({ path }),
        logged,
      );
      const skipped: WriteOutcome = "skipped";
      return skipped;
    }
    outcome = "created";
  } else {
    yield* processLiveText(mode.file, () => content);
    outcome = "overwritten";
  }

  if (excerpts) run.reportExcerpts?.(excerpts.summary());
  if (attachmentBatch) {
    const flushed = attachmentBatch;
    const copied = yield* Effect.promise(() => flushed.flush());
    yield* Effect.logDebug("Imported note attachments").pipe(
      Effect.annotateLogs({
        path,
        copied: copied.copied,
        skipped: copied.skipped,
        missing: copied.missing,
      }),
      logged,
    );
  }
  return outcome;
});

/** The parent Literature Note an explicitly created note inherits its Profile from. */
const parentLiteratureNote = Effect.fnUntraced(function* (
  note: ChildNote,
  options: Pick<ImportNoteOptions, "reads">,
) {
  if (note.parentItemID === null) return undefined;
  const parent = yield* readDisplayRef(options.reads, note.parentItemID);
  if (!parent) return undefined;
  const notes = yield* (yield* NoteIndex).getNotesByItemKey(parent.indexedKey);
  return notes[0];
});

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
const readParseInputs = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  note: Pick<Note, "libraryID" | "groupID">,
  options: { html: string; annotations: boolean },
) {
  const { html } = options;
  const { citedIndexedKeys, attachmentKeys } = noteReferences(
    html,
    note.groupID,
  );
  const annotationKeys = options.annotations ? noteAnnotationKeys(html) : [];
  const [citedItems, attachments, annotations] = yield* Effect.all(
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
  );
  const inputs: ParseInputs = {
    citedItems,
    attachments: new Map(attachments.map((a) => [a.key, a])),
    ...(annotations && { annotations }),
  };
  return inputs;
});

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
 * random suffix to guarantee uniqueness; a collision fails with
 * {@link NoteImportMintError}.
 */
const mintImportPath = Effect.fnUntraced(function* (
  importFolder: string,
  note: Pick<Note, "title" | "indexedKey">,
) {
  const folder = normalizeFolderPath(importFolder);
  const normalized = normalizeFilename(note.title ?? "");
  const base =
    normalized === ""
      ? `zotero_note_${note.indexedKey}`
      : truncateToByteLimit(normalized, MAX_IMPORT_BASE_BYTES);
  const name = `${base}_${randomFilenameId(SUFFIX_LENGTH)}.md`;
  const path = joinFolderPath(folder, name);
  if ((yield* (yield* Vault).getAbstractFileByPath(path)) !== null)
    return yield* new NoteImportMintError({ path });
  return path;
});

/**
 * Ensure the import folder exists in the vault.
 *
 * @param importFolderSetting - raw setting value (normalized internally).
 */
const ensureImportFolder = Effect.fnUntraced(function* (
  importFolderSetting: string,
) {
  const folder = normalizeFolderPath(normalizePath(importFolderSetting));
  if (folder === "/") return folder;
  const vault = yield* Vault;
  const existing = yield* vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return folder;
  if (existing instanceof TFile)
    return yield* new NoteImportFolderError({ path: folder });
  yield* vault.createFolder(folder);
  return folder;
});

/**
 * A minted import path collides with an existing vault file. The 6-char
 * suffix makes this near-impossible, so it is a hard error (no retry).
 */
export class NoteImportMintError extends Schema.TaggedError<
  NoteImportMintError,
  { readonly brand: unique symbol }
>()("NoteImportMintError", {
  /** The minted vault path that is taken. */
  path: Schema.String,
}) {
  override get message(): string {
    return `Imported note path collided with an existing file: ${this.path}`;
  }
}

/** A file, not a folder, holds the import folder's path. */
export class NoteImportFolderError extends Schema.TaggedError<
  NoteImportFolderError,
  { readonly brand: unique symbol }
>()("NoteImportFolderError", {
  /** The import folder's vault path. */
  path: Schema.String,
}) {
  override get message(): string {
    return `Cannot create folder; a file exists at "${this.path}"`;
  }
}
