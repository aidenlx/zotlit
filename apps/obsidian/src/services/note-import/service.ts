// Materializes Zotero Child Notes into flat Markdown mirrors on command.
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { normalizePath, stringifyYaml } from "obsidian";
import type { TFile } from "obsidian";

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
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { VaultError, VaultFolderBlockedError } from "@/lib/vault-errors";
import { ensureVaultFolder } from "@/lib/vault-folder";
import { AttachmentImport } from "@/services/attachment-import/service";
import type {
  AttachmentFlushError,
  AttachmentImportBatch,
} from "@/services/attachment-import/service";
import { outcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import type {
  ExcerptPrepareError,
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
import type { ProfileOperationError } from "@/services/profile/service";
import { syncTemplate } from "@/services/template-workbench/sync-template";
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
 * path is taken, Attachment Import or the excerpt preparation failed, or a
 * read or vault write failed, or the note conversion threw. A Template throw
 * outside the conversion is a defect that carries what was thrown.
 */
export type NoteImportError =
  | NoteImportProfileError
  | NoteImportMintError
  | VaultFolderBlockedError
  | ExcerptPrepareError
  | AttachmentFlushError
  | NoteImportParseError
  | Effect.Error<ReturnType<typeof readDisplayRef>>
  | ProfileOperationError
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

/** The services the note importer reads through their tags. */
type NoteImporterServices =
  | AttachmentImport
  | ExcerptPreparation
  | Profile
  | NoteIndex
  | Vault
  | Workspace
  | ZoteroPref;

/** The note importer over the graph's tags. */
export const layerNoteImporter = Layer.effect(
  NoteImporter,
  Effect.gen(function* () {
    const writes = yield* Semaphore.make(WRITE_CONCURRENCY);
    const context = yield* Effect.context<NoteImporterServices>();
    const templates = yield* syncTemplate;
    const ctx: Ctx = { templates };
    const run = <A, E>(effect: Effect.Effect<A, E, NoteImporterServices>) =>
      Effect.provideContext(effect, context);
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
  readonly templates: Effect.Success<typeof syncTemplate>;
}

const doImportNote = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: Note,
  options: ImportNoteOptions,
) {
  const { existing, profile } = yield* explicitImportTarget(note, options);
  if (existing)
    return yield* writeScoped(ctx, note, {
      mode: { action: "overwrite", file: existing },
      profile,
      options,
    });
  const folder = yield* ensureImportFolder(
    getProfileBinding(profile.settings, "note.import-folder"),
  );
  return yield* writeScoped(ctx, note, {
    mode: { action: "create", path: yield* mintImportPath(folder, note) },
    profile,
    options,
  });
});

/**
 * Write `note` with the run inputs of `options`. The write is its own
 * initiating batch when `options` names no outcome scope; that scope is
 * released once the write settles.
 */
const writeScoped = (
  ctx: Ctx,
  note: Note,
  {
    mode,
    profile,
    options,
  }: { mode: WriteMode; profile: ResolvedProfile; options: ImportNoteOptions },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      return yield* writeNote(ctx, note, {
        mode,
        run: {
          reads: options.reads,
          settings: profile.settings,
          attachmentFolderCache: options.attachmentFolderCache ?? new Map(),
          profile,
          reportExcerpts: options.reportExcerpts,
          outcomes: yield* outcomeScope(options.outcomes),
        },
      });
    }),
  );

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
    return yield* writeScoped(ctx, current, {
      mode: existing
        ? { action: "overwrite", file: existing }
        : { action: "create", path },
      profile,
      options: runOptions,
    });
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
    const profile = yield* profiles.resolveProfile(options.orphanProfile);
    if (!profile)
      return yield* NoteImportProfileError.unknown(options.orphanProfile, {
        indexedKey: note.indexedKey,
      });
    return { existing, profile, source, sourcePath: undefined };
  }
  const resolved = yield* profiles.profileOf(file);
  if (!resolved.ok)
    return yield* NoteImportProfileError.unknown(resolved.stamped.stamp, {
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
  let attachmentBatch: AttachmentImportBatch | undefined;
  let excerpts: PreparedExcerpts | undefined;
  if (note.note) {
    const html = note.note;
    const batch = yield* (yield* AttachmentImport).prepare(path, {
      folderCache: run.attachmentFolderCache,
    });
    attachmentBatch = batch;
    const templateMode = getProfileBinding(
      run.settings,
      "note.import-annotations-as-template",
    );
    const inputs = yield* readParseInputs(run.reads, note, {
      html,
      annotations: templateMode,
    });
    const annotations = inputs.annotations?.annotations;
    if (annotations?.length) {
      const prepared = yield* (yield* ExcerptPreparation).forNote({
        reads: run.reads,
        notePath: path,
        settings: run.profile.settings,
        previousNote: mode.action === "overwrite" ? mode.file : undefined,
        outcomes: run.outcomes,
      });
      excerpts = prepared;
      for (const annotation of annotations)
        prepared.annotationImageLink(annotation);
      yield* prepared.prepare;
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
    body = yield* Effect.try({
      try: () =>
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
      catch: (cause) => new NoteImportParseError({ cause }),
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

  // The write and its attachment copies run to the end: an interrupt never
  // leaves a written note that names attachments not yet copied.
  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      let outcome: WriteOutcome;
      if (mode.action === "create") {
        const created = yield* (yield* Vault).create(mode.path, content).pipe(
          Effect.as(true),
          Effect.catchTag("FileExists", () => Effect.succeed(false)),
        );
        if (!created) {
          yield* Effect.logWarning(
            "Imported note already exists; skipped",
          ).pipe(Effect.annotateLogs({ path }), logged);
          const skipped: WriteOutcome = "skipped";
          return skipped;
        }
        outcome = "created";
      } else {
        // The rewrite returns a fixed text, so it cannot throw.
        yield* processLiveText(mode.file, () => content).pipe(
          Effect.catchTag("LiveTextRewriteFailed", (error) =>
            Effect.die(error),
          ),
        );
        outcome = "overwritten";
      }

      if (excerpts) run.reportExcerpts?.(excerpts.summary());
      if (attachmentBatch) {
        const copied = yield* attachmentBatch.flush;
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
    }),
  );
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

/** The Profile a note write needs is not installed. */
export class NoteImportProfileError extends Schema.TaggedError<
  NoteImportProfileError,
  { readonly brand: unique symbol }
>()("NoteImportProfileError", {
  /** What the user can do: switch the note to an installed Profile. */
  diagnostic: Schema.Struct({
    code: Schema.Literal("unknown-literature-note-profile"),
    hint: Schema.String,
    recovery: Schema.Struct({ action: Schema.Literal("switch-profile") }),
    stamp: Schema.String,
    path: Schema.optional(Schema.String),
    indexedKey: Schema.optional(Schema.String),
  }),
  /** `false` when the note is the Literature Note the import reads from. */
  imported: Schema.Boolean,
}) {
  /** The error for the Profile `stamp` names, at the note `context` locates. */
  static unknown(
    stamp: string,
    context: { path?: string; indexedKey?: string; imported?: boolean },
  ): NoteImportProfileError {
    const { imported = true, ...diagnosticContext } = context;
    return new NoteImportProfileError({
      diagnostic: unknownProfileDiagnostic(stamp, diagnosticContext),
      imported,
    });
  }

  override get message(): string {
    const { stamp, path, indexedKey } = this.diagnostic;
    return this.imported
      ? m.notice_imported_note_profile_unknown({
          stamp,
          target: path ?? indexedKey ?? stamp,
        })
      : m.notice_literature_note_profile_unknown({ stamp });
  }
}

/**
 * The note conversion threw, for example when the Citation Template or the
 * annotation Template fails. The message is the throw's own.
 */
export class NoteImportParseError extends Schema.TaggedError<
  NoteImportParseError,
  { readonly brand: unique symbol }
>()("NoteImportParseError", {
  /** What the conversion threw. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    if (this.cause instanceof Error) return this.cause.message;
    return typeof this.cause === "string" ? this.cause : "Unknown error";
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
  yield* ensureVaultFolder(folder);
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
