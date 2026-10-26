import { DateTime, Effect } from "effect";
import type { TFile } from "obsidian";

import type { CitationVariant, CiteRef, Item, ItemFacets } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { toInstant } from "@/lib/effect-clock";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { DEFAULT_PROFILE, unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { classifyStream, runBatch } from "@/services/batch-run";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@/services/note-index/service";
import { selectProfilesByMatch } from "@/services/profile-selection";
import type { MatchSelection } from "@/services/profile-selection";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { relocatedNotePath } from "@/services/profile/relocation";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { renderAnnotationCitation } from "./annotation-citation";
import type { AnnotationCitation } from "./annotation-citation";
import { renderCitation } from "./citation";
import { applyComposedFrontmatter } from "./compose";
import {
  resolveNotePath,
  templateFacets,
  resolveRenderedNotePath,
} from "./context";
import type { NoteFeatureDeps } from "./context";
import { refusedCreate } from "./diagnostics";
import { prepareManagedFrontmatter } from "./frontmatter";
import { prepareAnnotationInsert } from "./insert-annotation";
import type { AnnotationInsertOptions } from "./insert-annotation";
import type {
  CompanionNoteTarget,
  CreateNoteInternalOptions,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlan,
  CreationPlanOptions,
  CreationProfileSelection,
  CreationProfileSources,
  CreationSelectionProblem,
  NoteFeatureEvents,
  OpsContext,
  PreparedCreationProfile,
  PreparedProfileSwitch,
  ProfileNotePreview,
  ProfileNotePreviewOptions,
  ProfilePreview,
  UpdateResult,
  WriteNoteUpdateOptions,
} from "./types";
import {
  createNote,
  getImportedNotesForItem,
  overwriteNote,
  readItem,
  relocationSource,
  replacedKeys,
  resolveProfileDocument,
  switchNoteProfile,
  updateNote,
  writeNoteUpdate,
} from "./write-pipeline";

export type {
  CompanionNoteTarget,
  CreateNoteDiagnostic,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlan,
  CreationPlanOptions,
  CreationProfileSelection,
  CreationProfileSource,
  CreationProfileSources,
  CreationSelectionProblem,
  ExistingNoteDiagnostic,
  LiteratureNoteTemplateConversionRequiredDiagnostic,
  ManagedFrontmatterFailureDiagnostic,
  ManagedFrontmatterRefusalDiagnostic,
  MissingLiteratureNoteTemplateDiagnostic,
  NoteFeatureEvents,
  NoteKeyChangedDiagnostic,
  NoteOperationDiagnostic,
  NoteProfileChangedDiagnostic,
  NoteProfileConflictDiagnostic,
  PreparedCreationProfile,
  PreparedProfileSwitch,
  ProfileNotePreview,
  ProfileNotePreviewOptions,
  ProfilePreview,
  UpdateResult,
  UpdateScope,
  WriteNoteUpdateOptions,
} from "./types";

const logger = getLogger("note-feature");

const MAX_UNINDEXED_CREATES = 256;

/**
 * The bound note-feature operations returned by {@link createNoteFeature}.
 * Consumers hold this object; the collaborators stay behind the seam.
 */
export interface NoteFeature {
  reportExcerptImages(summary: ExcerptSummary): void;
  /**
   * Settles when templates and the note index are usable. Single-item methods
   * gate internally; batch runners await this once per run before a
   * {@link NoteFeature.writeNoteUpdate} loop (which assumes readiness).
   */
  ready: Promise<void>;
  resolveCompanionNote(
    indexedKey: string,
    options?: { profile?: ProfileSelector },
  ): Promise<CompanionNoteTarget>;
  /** The creation Profile when no Item decides: the given or the Default. */
  resolveCreationProfile(
    sources?: CreationProfileSources,
  ): Promise<CreationProfileSelection>;
  /**
   * How each Indexed Key's note would be created, by key: its Item, its
   * selected Profile, and each selectable Profile's preview. A batch costs one
   * Match query and one facet stream, however many keys it holds.
   */
  planCreations(
    indexedKeys: readonly string[],
    options?: CreationPlanOptions,
  ): Promise<ReadonlyMap<string, CreationPlan>>;
  prepareProfileNote(options: ProfileNotePreviewOptions): ProfileNotePreview;
  prepareProfileSwitch(file: TFile): Promise<PreparedProfileSwitch>;
  /** @see createNote */
  createNote(
    item: Item,
    options?: CreateNoteOptions,
  ): Promise<CreateNoteResult>;
  /** @see updateNote */
  updateNote(
    file: TFile,
    options: {
      indexedKey: string;
      scope?: UpdateScope;
      profile?: ProfileSelector;
      /**
       * Recheck a caller-owned editing session just before the note's one
       * write; throwing leaves the note untouched. The write itself checks the
       * note's Zotero key and refuses a note that no longer carries
       * `indexedKey` with `literature-note-key-changed`.
       */
      beforeWrite?: () => void;
    },
  ): Promise<UpdateResult>;
  /** Re-stamp after consent; the next update renders with the target Profile. */
  switchNoteProfile(
    file: TFile,
    options: {
      profile: ProfileSelector;
      importedNotes?: readonly TFile[];
      move?: boolean;
    },
  ): Promise<UpdateResult>;
  /** Imported Notes currently materialized for one Zotero item. */
  getImportedNotesForItem(indexedKey: string): Promise<TFile[]>;
  /** @see replacedKeys */
  replacedKeys(file: TFile): Promise<ReadonlySet<string>>;
  /** @see overwriteNote */
  overwriteNote(
    file: TFile,
    indexedKey: string,
    options?: { outcomes?: ExcerptOutcomeScope },
  ): Promise<UpdateResult>;
  /** @see writeNoteUpdate */
  writeNoteUpdate(
    file: TFile,
    options: WriteNoteUpdateOptions,
  ): Promise<UpdateResult>;
  /** @see renderCitation */
  renderCitation(
    items: readonly CiteRef[],
    variant: CitationVariant,
  ): string | null;
  /** @see renderAnnotationCitation */
  renderAnnotationCitation(annotationKey: string): Promise<AnnotationCitation>;
  prepareAnnotationInsert(
    options: AnnotationInsertOptions,
  ): ReturnType<typeof prepareAnnotationInsert>;
  /** Subscribe to {@link NoteFeatureEvents}; returns an unsubscribe. */
  on<K extends keyof NoteFeatureEvents>(
    event: K,
    cb: NoteFeatureEvents[K],
  ): () => void;
}

/**
 * Bind the note-feature operations to `deps` once (in `build.ts`). The bound
 * object is the module's external seam — consumers call its methods and never
 * see the collaborators. The closure serializes creates by Indexed Key and
 * retains newly created files until the Note Index observes them. Compiled
 * template artifacts live in {@link TemplateService}.
 */
export function createNoteFeature(deps: NoteFeatureDeps): NoteFeature {
  const events = createNanoEvents<NoteFeatureEvents>();
  const ctx: NoteFeatureDeps & OpsContext = { ...deps, events };
  const pendingCreates = new Map<string, Promise<CreateNoteResult>>();
  const createdBeforeIndex = new Map<string, TFile>();

  const createAtGate = (
    item: Item,
    options?: CreateNoteInternalOptions,
  ): Promise<CreateNoteResult> => {
    const { indexedKey } = item;
    const pending = pendingCreates.get(indexedKey);
    if (pending) {
      return pending.then((result) =>
        result.outcome === "created"
          ? refusedCreate(indexedKey, [result.file])
          : result,
      );
    }

    const recent = createdBeforeIndex.get(indexedKey);
    if (recent) {
      const indexed = deps.noteIndex.getNotesByItemKey(indexedKey);
      if (indexed.length > 0) {
        createdBeforeIndex.delete(indexedKey);
        return Promise.resolve(refusedCreate(indexedKey, indexed));
      }
      if (deps.app.vault.getAbstractFileByPath(recent.path) === recent) {
        const cache = deps.app.metadataCache.getFileCache(recent);
        if (cache === null || itemKeyFromFrontmatter(cache) === indexedKey) {
          return Promise.resolve(refusedCreate(indexedKey, [recent]));
        }
      }
      createdBeforeIndex.delete(indexedKey);
    }

    const task = createNote(ctx, item, {
      ...options,
      onFileCreated: (file) => {
        if (
          createdBeforeIndex.size >= MAX_UNINDEXED_CREATES &&
          !createdBeforeIndex.has(indexedKey)
        ) {
          const oldest = createdBeforeIndex.keys().next().value;
          if (oldest !== undefined) createdBeforeIndex.delete(oldest);
        }
        createdBeforeIndex.set(indexedKey, file);
      },
    });
    pendingCreates.set(indexedKey, task);
    void task.then(
      () => {
        if (pendingCreates.get(indexedKey) === task) {
          pendingCreates.delete(indexedKey);
        }
      },
      () => {
        if (pendingCreates.get(indexedKey) === task) {
          pendingCreates.delete(indexedKey);
        }
      },
    );
    return task;
  };

  return {
    reportExcerptImages: (summary) =>
      events.emit("excerpt-images-reported", summary),
    ready: Promise.resolve(),
    createNote: createAtGate,
    resolveCompanionNote: (indexedKey, options) =>
      resolveCompanionNote(ctx, indexedKey, options),
    resolveCreationProfile: (sources) => resolveCreationProfile(ctx, sources),
    planCreations: (indexedKeys, options) =>
      planCreations(ctx, indexedKeys, { ...options, create: createAtGate }),
    prepareProfileNote: (options) =>
      prepareProfileNote(ctx, options, createAtGate),
    prepareProfileSwitch: (file) => prepareProfileSwitch(ctx, file),
    updateNote: (file, options) => updateNote(ctx, file, options),
    switchNoteProfile: (file, options) => switchNoteProfile(ctx, file, options),
    getImportedNotesForItem: (indexedKey) =>
      getImportedNotesForItem(ctx, indexedKey),
    replacedKeys: (file) => replacedKeys(ctx, file),
    overwriteNote: (file, indexedKey, options) =>
      overwriteNote(ctx, file, { ...options, indexedKey }),
    writeNoteUpdate: (file, options) => writeNoteUpdate(ctx, file, options),
    renderCitation: (items, variant) => renderCitation(ctx, items, variant),
    renderAnnotationCitation: (annotationKey) =>
      renderAnnotationCitation(ctx, annotationKey),
    prepareAnnotationInsert: (options) => prepareAnnotationInsert(ctx, options),
    on: (event, cb) => events.on(event, cb),
  };
}

async function resolveCompanionNote(
  ctx: NoteFeatureDeps,
  indexedKey: string,
  options: { profile?: ProfileSelector } = {},
): Promise<CompanionNoteTarget> {
  await ctx.noteIndex.whenIndexed();
  if (
    options.profile !== undefined &&
    !ctx.profile.resolveProfile(options.profile)
  ) {
    logger.debug("Refused unknown Companion Profile", {
      indexedKey,
      requestedProfile: options.profile,
    });
    return {
      outcome: "refused",
      diagnostic: unknownProfileDiagnostic(options.profile, { indexedKey }),
    };
  }
  const files = ctx.noteIndex.getNotesByItemKey(indexedKey);
  const file = files[0];
  if (!file) {
    logger.debug("Companion target needs a Literature Note", { indexedKey });
    return { outcome: "create" };
  }
  const resolved = ctx.profile.profileOf(file);
  if (!resolved.ok) {
    logger.debug("Resolved Companion target with unknown stamp", {
      indexedKey,
      path: file.path,
      stamp: resolved.stamped.stamp,
    });
    return {
      outcome: "existing",
      files: [file, ...files.slice(1)],
      diagnostic: unknownProfileDiagnostic(resolved.stamped.stamp, {
        indexedKey,
        path: file.path,
      }),
    };
  }
  const { selector, label } = resolved.profile;
  const keptProfile =
    options.profile !== undefined && options.profile !== selector
      ? { selector, label }
      : undefined;
  logger.debug("Resolved existing Companion note", {
    indexedKey,
    path: file.path,
    selector,
    requestedProfile: options.profile,
    kept: keptProfile !== undefined,
  });
  return { outcome: "existing", files: [file, ...files.slice(1)], keptProfile };
}

/**
 * How each Indexed Key's note would be created: its Item in one Snapshot, the
 * Profile its sources or its Profile Match select, and each selectable
 * Profile's preview. The facets the paths render from stream from the worker,
 * and the Matches of every Item are tested in one query. A path one Item takes
 * is reserved, so a later Item of the batch gets its own. A key the Snapshot
 * lacks has no Item and no previews; its Profile is the given or the Default.
 */
async function planCreations(
  ctx: NoteFeatureDeps,
  indexedKeys: readonly string[],
  options: CreationPlanOptions & {
    create: (
      item: Item,
      options: CreateNoteInternalOptions,
    ) => Promise<CreateNoteResult>;
  },
): Promise<ReadonlyMap<string, CreationPlan>> {
  const signal = options.signal ?? new AbortController().signal;
  await ctx.noteIndex.whenIndexed();
  signal.throwIfAborted();
  const shouldAsk = ctx.profile.profiles.length > 0;
  const given = givenCreationProfile(ctx, options, shouldAsk);
  await using lease = await ctx.zoteroReads.acquireRead();
  const itemsByKey = await Effect.runPromise(
    lease.reads.ItemsByIndexedKeys({ indexedKeys }),
    { signal },
  );
  const items = indexedKeys.flatMap((key) => itemsByKey.get(key) ?? []);
  const [previews, matches] = await Promise.all([
    prepareCreationPreviews(ctx, items, {
      reads: lease.reads,
      create: options.create,
      signal,
    }),
    given
      ? undefined
      : selectProfilesByMatch(ctx.profile.profiles, items, {
          query: ctx.query,
          signal,
        }),
  ]);
  const matchByItemID = new Map(
    items.map((item, index) => [item.itemID, matches?.[index]]),
  );
  return new Map(
    indexedKeys.map((key) => {
      const item = itemsByKey.get(key);
      return [
        key,
        {
          item,
          selection:
            given ??
            matchedCreationProfile(item, {
              result: item && matchByItemID.get(item.itemID),
              shouldAsk,
            }),
          previews: (item && previews.get(item.itemID)) ?? [],
        },
      ];
    }),
  );
}

/**
 * Each selectable Profile's preview for each of `items`, by itemID, rendered
 * slice by slice as the worker streams the Items' facets.
 */
async function prepareCreationPreviews(
  ctx: NoteFeatureDeps,
  items: readonly Item[],
  options: {
    reads: ZoteroReadsApi;
    create: (
      item: Item,
      options: CreateNoteInternalOptions,
    ) => Promise<CreateNoteResult>;
    signal: AbortSignal;
  },
): Promise<ReadonlyMap<number, readonly PreparedCreationProfile[]>> {
  const profiles = selectableProfiles(ctx).map((profile) => ({
    profile,
    document: resolveProfileDocument(ctx, profile),
    reserved: new Set<string>(),
  }));
  const itemsByID = new Map(items.map((item) => [item.itemID, item]));
  const previews = new Map<number, readonly PreparedCreationProfile[]>();
  const previewOf = (
    item: Item,
    facets: ItemFacets,
    { profile, document, reserved }: (typeof profiles)[number],
  ): PreparedCreationProfile => {
    const { selector } = profile;
    let preparedPath: { path: string } | undefined;
    let unavailable: string | undefined;
    try {
      if (document === null)
        throw new Error(
          m.notice_literature_note_template_missing({
            document: profile.document!,
          }),
        );
      preparedPath = resolveNotePath(ctx, item, {
        ...templateFacets(facets),
        settings: profile.settings,
        document,
        reservedPaths: reserved,
      });
      reserved.add(preparedPath.path);
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
      logger.debug("Profile creation preview is unavailable", {
        indexedKey: item.indexedKey,
        selector,
        error,
      });
    }
    return {
      ...profilePreview(profile, preparedPath?.path),
      unavailable,
      create: (reporting) =>
        options.create(item, { ...reporting, profile: selector, preparedPath }),
    };
  };
  await runBatch(
    classifyStream(
      {
        itemIDs: items.map(({ itemID }) => itemID),
        read: (ids) =>
          options.reads.ItemFacets({
            items: ids.map((itemID) => ({
              itemID,
              libraryID: itemsByID.get(itemID)!.libraryID,
            })),
          }),
      },
      { onProgress: () => {} },
      (slice) => {
        for (const { itemID, facets } of slice) {
          const item = itemsByID.get(itemID)!;
          previews.set(
            itemID,
            profiles.map((profile) => previewOf(item, facets, profile)),
          );
        }
      },
    ),
    options.signal,
  );
  logger.debug("Prepared creation previews for {count} Items", {
    count: items.length,
  });
  return previews;
}

function selectableProfiles(ctx: NoteFeatureDeps): ResolvedProfile[] {
  const selectors: ProfileSelector[] = [
    DEFAULT_PROFILE,
    ...ctx.profile.profiles.map(({ id }) => id),
  ];
  return selectors.flatMap((selector) => {
    const profile = ctx.profile.resolveProfile(selector);
    return profile ? [profile] : [];
  });
}

function profilePreview(
  profile: ResolvedProfile,
  path: string | undefined,
): ProfilePreview {
  return {
    selector: profile.selector,
    label: profile.label,
    folder: profile.bindings["note.literature-folder"],
    citationStyle: profile.bindings["citation.references-style"],
    document: profile.document,
    path,
  };
}

/**
 * The creation Profile when no Item decides: the asked or headless one, or
 * the Default. The operation fixes this result; subsequent operations read the
 * current registry.
 */
async function resolveCreationProfile(
  ctx: NoteFeatureDeps,
  sources: CreationProfileSources = {},
): Promise<CreationProfileSelection> {
  const shouldAsk = ctx.profile.profiles.length > 0;
  return (
    givenCreationProfile(ctx, sources, shouldAsk) ??
    matchedCreationProfile(undefined, { shouldAsk })
  );
}

function stoppedCreationProfile(
  problem: CreationSelectionProblem,
  item: Item | undefined,
): CreationProfileSelection {
  logger.debug("Creation Profile selection stopped ({kind})", {
    kind: problem.kind,
    indexedKey: item?.indexedKey,
  });
  return {
    selector: DEFAULT_PROFILE,
    source: "bound",
    shouldAsk: true,
    problem,
  };
}

/** The Profile the caller asked for, or the headless one, when given. */
function givenCreationProfile(
  ctx: NoteFeatureDeps,
  sources: CreationProfileSources,
  shouldAsk: boolean,
): CreationProfileSelection | undefined {
  for (const source of ["asked", "headless"] as const) {
    const selector = sources[source];
    if (selector === undefined) continue;
    if (!ctx.profile.resolveProfile(selector))
      return stoppedCreationProfile(
        { kind: "invalid-selector", source, selector },
        undefined,
      );
    logger.debug("Resolved creation Profile {selector} from {source}", {
      selector,
      source,
    });
    return { selector, source, shouldAsk };
  }
  return undefined;
}

/** The Profile an Item's Match selects; with no Match known, the Default. */
function matchedCreationProfile(
  item: Item | undefined,
  { result, shouldAsk }: { result?: MatchSelection; shouldAsk: boolean },
): CreationProfileSelection {
  if (result?.outcome === "overlap")
    return stoppedCreationProfile(
      { kind: "overlap", candidates: result.candidates },
      item,
    );
  // With no Match known, the researcher chooses the Profile.
  if (result?.outcome === "failed")
    return { selector: DEFAULT_PROFILE, source: "bound", shouldAsk: true };
  if (result?.outcome === "matched")
    return {
      selector: result.profile.id,
      source: "match",
      shouldAsk: false,
      reason: m.profile_match_selected(result.reason),
    };
  return { selector: DEFAULT_PROFILE, source: "bound", shouldAsk };
}

function prepareProfileNote(
  ctx: OpsContext,
  options: ProfileNotePreviewOptions,
  create: (
    item: Item,
    options: CreateNoteInternalOptions,
  ) => Promise<CreateNoteResult>,
): ProfileNotePreview {
  const { profile, document, note, filename } = options;
  const preparedPath = resolveRenderedNotePath(
    profile.bindings["note.literature-folder"],
    document.renderFilename(filename),
    { exists: (path) => ctx.app.vault.getAbstractFileByPath(path) !== null },
  );
  const prepared = prepareManagedFrontmatter(
    document.frontmatter,
    note,
    toInstant(ctx.bridge.runSync(DateTime.now)),
  );
  if ("failures" in prepared)
    throw new Error(m.managed_frontmatter_refused_recovery());
  const properties: Record<string, unknown> = {};
  applyComposedFrontmatter(ctx, properties, {
    context: note,
    itemKey: note.indexedKey,
    profile,
    prepared: prepared.prepared,
  });
  const body = document.renderForCreate(note);
  return {
    path: preparedPath.path,
    body,
    properties,
    create: async () => {
      // One Snapshot for the Item lookup and the body; the filename is the
      // one the preview showed.
      await using lease = await ctx.zoteroReads.acquireRead();
      const item = await readItem(lease.reads, note.indexedKey);
      if (!item) throw new Error(m.notice_protocol_item_not_found());
      // Awaited inside the lease's scope, which the create reads through.
      return await create(item, {
        profile: profile.selector,
        preparedPath,
        reads: lease.reads,
      });
    },
  };
}

async function prepareProfileSwitch(
  ctx: NoteFeatureDeps,
  file: TFile,
): Promise<PreparedProfileSwitch> {
  const current = ctx.profile.profileOf(file);
  const cache = ctx.app.metadataCache.getFileCache(file);
  const imported = noteKeyFromFrontmatter(cache) !== null;
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (!imported && !indexedKey)
    throw new Error("The file is not a ZotLit note");
  const source = relocationSource(current);
  const profiles = selectableProfiles(ctx).map((profile) => ({
    ...profilePreview(
      profile,
      relocatedNotePath(file, { from: source, to: profile, imported }),
    ),
    folder:
      profile.bindings[
        imported ? "note.import-folder" : "note.literature-folder"
      ],
  }));
  let importedNotes: TFile[] | null = [];
  if (!imported) {
    try {
      importedNotes = await getImportedNotesForItem(ctx, indexedKey!);
    } catch (error) {
      importedNotes = null;
      logger.debug(
        "Could not check Imported Notes while preparing a Profile switch",
        { path: file.path, indexedKey, error },
      );
    }
  }
  logger.debug("Prepared note Profile switch", {
    path: file.path,
    imported,
    profiles: profiles.length,
    importedNotes: importedNotes?.length ?? null,
  });
  return {
    imported,
    current: current.ok
      ? { selector: current.profile.selector, label: current.profile.label }
      : { selector: undefined, label: current.stamped.stamp },
    profiles,
    importedNotes,
  };
}
