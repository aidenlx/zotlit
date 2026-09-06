import { stringifyYaml } from "obsidian";
import type { TFile } from "obsidian";

import {
  citekeysToCiteTemplateData,
  CollectionCache,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByItemId,
  getChildNotesByParentIDs,
  getZoteroIdentity,
  getItemsByKey,
  resolveIndexedKeyLibrary,
  resolveItemTags,
} from "@zotlit/db";
import type {
  CiteRef,
  GroupIDMemo,
  Item,
  NoteTemplateContext,
  TagMemo,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type { UpdateScope } from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";
import type { Emitter } from "@zotlit/shared/nanoevents";
import { inlineCitation } from "@zotlit/templates";
import { stringifyFrontmatterInOrder } from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import {
  annotationCitation,
  buildAnnotationResolvers,
  renderAnnotations,
} from "@/lib/annotation-render";
import {
  FIELD_CITATION_STYLE,
  FIELD_LITERATURE_NOTE_PROFILE,
} from "@/lib/constants";
import {
  ensureParentFolder,
  joinFolderPath,
  normalizeFolderPath,
} from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import {
  DEFAULT_PROFILE,
  readProfileStamp,
  unknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import { isFileExistsError } from "@/lib/vault-errors";
import type { AttachmentImport } from "@/services/attachment-import/service";
import type { NoteImport } from "@/services/note-import/service";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@/services/note-index/service";
import {
  resolveMembershipFacts,
  ruleItem,
  selectProfileByRules,
} from "@/services/profile-selection";
import type {
  ConditionProblem,
  ProfileSelectionRule,
} from "@/services/profile-selection";
import { noteProfileSelector } from "@/services/profile/bindings";
import type { NoteProfile, ResolvedProfile } from "@/services/profile/bindings";
import type { Settings } from "@/services/settings/schema";
import { ProfileAnnotationError } from "@/services/template/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";

import {
  buildNoteResolvers,
  fetchItemCollections,
  resolveNotePath,
  resolveRenderedNotePath,
} from "./context";
import type { NoteFeatureDeps, SyncRenderDeps } from "./context";
import {
  applyDocumentManagedFrontmatter,
  applyManagedFrontmatter,
  prepareManagedFrontmatter,
} from "./frontmatter";
import type { PreparedManagedFrontmatter } from "./frontmatter";

const logger = getLogger("note-feature");

// Tolerates CRLF: Obsidian's processFrontMatter preserves the note's
// original line-ending bytes in the `---` delimiters, so a CRLF-authored
// note must still match here or its frontmatter prefix is dropped.
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n+|$)/;
const MAX_UNINDEXED_CREATES = 256;

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
  noManagedBlock?: true;
  diagnostic?: NoteOperationDiagnostic;
}

export interface ExistingNoteDiagnostic {
  code: "literature-note-exists" | "duplicate-literature-notes";
  hint: string;
  indexedKey: string;
  paths: [string, ...string[]];
}

/** A Companion link chooses creation only after existing stamps have won. */
export type CompanionNoteTarget =
  | { outcome: "create" }
  | {
      outcome: "existing";
      files: readonly [TFile, ...TFile[]];
      keptProfile?: Pick<ResolvedProfile, "selector" | "label">;
      diagnostic?: UnknownProfileDiagnostic;
    }
  | { outcome: "refused"; diagnostic: UnknownProfileDiagnostic };

export interface NoteProfileConflictDiagnostic {
  code: "literature-note-profile-conflict";
  hint: string;
  indexedKey: string;
  path: string;
  existingProfile: ProfileSelector;
  requestedProfile: ProfileSelector;
}

export interface MissingLiteratureNoteTemplateDiagnostic {
  code: "missing-literature-note-template";
  hint: string;
  document: string;
  path?: string;
  indexedKey?: string;
}

export interface LiteratureNoteTemplateConversionRequiredDiagnostic {
  code: "literature-note-template-conversion-required";
  hint: string;
  profileId: ProfileId;
  path?: string;
  indexedKey?: string;
}

export interface ManagedFrontmatterFailureDiagnostic {
  field: string;
  message: string;
  hint: string;
}

export interface ManagedFrontmatterRefusalDiagnostic {
  code: "managed-frontmatter-refused";
  hint: string;
  failures: [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  path?: string;
  indexedKey?: string;
}

export type NoteOperationDiagnostic =
  | UnknownProfileDiagnostic
  | NoteProfileConflictDiagnostic
  | MissingLiteratureNoteTemplateDiagnostic
  | LiteratureNoteTemplateConversionRequiredDiagnostic
  | ManagedFrontmatterRefusalDiagnostic;

export type CreateNoteDiagnostic =
  | ExistingNoteDiagnostic
  | NoteOperationDiagnostic;

export type CreateNoteResult =
  | { outcome: "created"; file: TFile }
  | { outcome: "refused"; diagnostic: CreateNoteDiagnostic };

export interface CreationProfileSources {
  /** A Profile a command or Companion link supplied explicitly. */
  headless?: ProfileSelector;
  /** The user's manual choice for this operation. */
  asked?: ProfileSelector;
  /**
   * The Item the note is created for. Supplies the facts Profile Selection
   * Rules read; omitted, no rule takes part.
   */
  item?: Item;
}

/**
 * Where a creation Profile came from, in priority order: `asked` (a manual
 * choice for this operation) over `headless` (explicit operation input) over
 * `rule` (the first matching Profile Selection Rule) over `bound` (Default).
 */
export type CreationProfileSource = "asked" | "headless" | "rule" | "bound";

/**
 * Why automatic selection stopped. The selection falls back to Default with
 * `shouldAsk` set, so the user chooses explicitly for the affected Item.
 */
export type CreationSelectionProblem =
  | {
      kind: "broken-rule";
      rule: ProfileSelectionRule;
      problem: ConditionProblem;
    }
  | {
      kind: "unavailable-target";
      rule: ProfileSelectionRule;
      selector: ProfileSelector;
    }
  | {
      kind: "invalid-selector";
      source: Extract<CreationProfileSource, "asked" | "headless">;
      selector: ProfileSelector;
    };

export type CreationProfileSelection = {
  selector: ProfileSelector;
  /**
   * Whether the creation surface should confirm the selection: other
   * Profiles exist, or automatic selection stopped with a `problem`.
   */
  shouldAsk: boolean;
  problem?: CreationSelectionProblem;
} & (
  | {
      source: "rule";
      /** The rule that selected the Profile. */
      rule: ProfileSelectionRule;
    }
  | { source: "asked" | "headless"; rule?: undefined }
  | { source: "bound"; rule?: undefined }
);

/** Effective Profile bindings and the path relevant to the pending action. */
export interface ProfilePreview {
  selector: ProfileSelector;
  label: string | undefined;
  folder: string;
  citationStyle: string | null;
  document: string | undefined;
  path: string | undefined;
  unavailable?: string;
}

export interface PreparedCreationProfile extends ProfilePreview {
  /** Re-enters the create gate; the preview holds no database lease. */
  create(): Promise<CreateNoteResult>;
}

export interface ProfileNotePreview {
  path: string;
  body: string;
  properties: Record<string, unknown>;
  create(): Promise<CreateNoteResult>;
}
export interface ProfileNotePreviewOptions {
  profile: ResolvedProfile;
  document: ResolvedLiteratureNoteTemplate;
  note: NoteTemplateContext;
  filename: object;
}

export interface PreparedProfileSwitch {
  imported: boolean;
  current: { selector: ProfileSelector | undefined; label: string | undefined };
  profiles: ProfilePreview[];
  /** Null when the source item or database could not supply the family lookup. */
  importedNotes: TFile[] | null;
}

// `UpdateScope` is the wire enum obsidian decodes; re-export it so note-feature
// consumers keep a stable import path without redeclaring the union.
export type { UpdateScope };

/** Result for an update that intentionally leaves the body region untouched. */
const NO_BODY_UPDATE: UpdateResult = {
  bodyUpdated: false,
  duplicateRegionCount: 0,
};

/**
 * Concurrent/batch creation can land a sibling between resolve and write. Each
 * retry forces a fresh `suffix()`, so even one almost always frees the name;
 * the bound just stops an unbounded loop.
 */
const MAX_CREATE_RETRIES = 5;

/** Per-batch memos threaded through a multi-item create run. */
export interface CreateNoteOptions {
  collectionCache?: CollectionCache;
  tagMemo?: TagMemo;
  groupIdMemo?: GroupIDMemo;
  /**
   * The batch supplies the once-resolved account username; a single-item create
   * resolves it from its own lease when omitted.
   */
  username?: string | null;
  /**
   * Omitted names no Profile: an existing note is accepted as it is stamped.
   * `DEFAULT_PROFILE` names the default Profile explicitly, so a note stamped
   * with another Profile is a conflict rather than accepted as-is.
   */
  profile?: ProfileSelector;
}

interface CreateNoteInternalOptions extends CreateNoteOptions {
  onFileCreated?: (file: TFile) => void;
  preparedPath?: { path: string; canSuffix: boolean };
}

/**
 * Batch-threaded write: the caller owns the run-wide lease and passes its pinned
 * `client` plus the run's shared memos, so no per-item lease re-acquisition.
 */
export interface WriteNoteUpdateOptions {
  client: NodeDatabaseClient;
  item: Item;
  tagMemo: TagMemo;
  collectionCache: CollectionCache;
  settings: Readonly<Settings>;
  scope?: UpdateScope;
  groupIdMemo?: GroupIDMemo;
  /** Once-resolved account username for the batch. */
  username: string | null;
  /** Headless explicit Profile. A different stamp is refused. */
  profile?: ProfileSelector;
}

/** Events the bound note feature emits; a UI subscriber owns any rendering. */
export interface NoteFeatureEvents {
  /**
   * A legacy settings-held frontmatter expression failed during a write; the
   * write completed with those keys skipped.
   */
  "frontmatter-eval-failed": (payload: {
    itemKey: string;
    fields: string[];
  }) => void;
}

/** Deps plus the feature's emitter, threaded through the internal operations. */
type OpsContext = NoteFeatureDeps & { events: Emitter<NoteFeatureEvents> };

/**
 * The bound note-feature operations returned by {@link createNoteFeature}.
 * Consumers hold this object; the collaborators stay behind the seam.
 */
export interface NoteFeature {
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
  resolveCreationProfile(
    sources?: CreationProfileSources,
  ): Promise<CreationProfileSelection>;
  prepareCreationProfiles(item: Item): Promise<PreparedCreationProfile[]>;
  prepareBatchCreationProfiles(
    items: readonly Item[],
    options?: { signal?: AbortSignal },
  ): Promise<ReadonlyMap<number, readonly PreparedCreationProfile[]>>;
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
  /** @see overwriteNote */
  overwriteNote(file: TFile, indexedKey: string): Promise<UpdateResult>;
  /** @see writeNoteUpdate */
  writeNoteUpdate(
    file: TFile,
    options: WriteNoteUpdateOptions,
  ): Promise<UpdateResult>;
  /** @see renderCitation */
  renderCitation(items: readonly CiteRef[], secondary?: boolean): string | null;
  /** @see renderAnnotation */
  renderAnnotation(
    annotationItemId: number,
    options: {
      attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    },
  ): string | null;
  /** @see renderAnnotationCitation */
  renderAnnotationCitation(annotationItemId: number): string | null;
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
export function createNoteFeature(deps: SyncRenderDeps): NoteFeature {
  const events = createNanoEvents<NoteFeatureEvents>();
  const ctx: SyncRenderDeps & OpsContext = { ...deps, events };
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
    ready: Promise.all([
      deps.template.ready,
      deps.noteIndex.ready,
      deps.profile.ready,
    ]).then(() => {}),
    createNote: createAtGate,
    resolveCompanionNote: (indexedKey, options) =>
      resolveCompanionNote(ctx, indexedKey, options),
    resolveCreationProfile: (sources) => resolveCreationProfile(ctx, sources),
    prepareCreationProfiles: (item) =>
      prepareCreationProfiles(ctx, item, { create: createAtGate }),
    prepareBatchCreationProfiles: (items, options) =>
      prepareBatchCreationProfiles(ctx, items, {
        create: createAtGate,
        ...options,
      }),
    prepareProfileNote: (options) =>
      prepareProfileNote(ctx, options, createAtGate),
    prepareProfileSwitch: (file) => prepareProfileSwitch(ctx, file),
    updateNote: (file, options) => updateNote(ctx, file, options),
    switchNoteProfile: (file, options) => switchNoteProfile(ctx, file, options),
    getImportedNotesForItem: (indexedKey) =>
      getImportedNotesForItem(ctx, indexedKey),
    overwriteNote: (file, indexedKey) => overwriteNote(ctx, file, indexedKey),
    writeNoteUpdate: (file, options) => writeNoteUpdate(ctx, file, options),
    renderCitation: (items, secondary = false) =>
      renderCitation(ctx, items, secondary),
    renderAnnotation: (annotationItemId, options) =>
      renderAnnotation(ctx, annotationItemId, options),
    renderAnnotationCitation: (annotationItemId) =>
      renderAnnotationCitation(ctx, annotationItemId),
    on: (event, cb) => events.on(event, cb),
  };
}

async function resolveCompanionNote(
  ctx: NoteFeatureDeps,
  indexedKey: string,
  options: { profile?: ProfileSelector } = {},
): Promise<CompanionNoteTarget> {
  await Promise.all([ctx.profile.ready, ctx.noteIndex.whenIndexed()]);
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

async function prepareCreationProfiles(
  ctx: NoteFeatureDeps,
  item: Item,
  options: {
    create: (
      item: Item,
      options: CreateNoteInternalOptions,
    ) => Promise<CreateNoteResult>;
    reservedPaths?: Map<ProfileSelector, Set<string>>;
  },
): Promise<PreparedCreationProfile[]> {
  await Promise.all([
    ctx.settings.loaded,
    ctx.profile.ready,
    ctx.template.ready,
    ctx.noteIndex.whenIndexed(),
  ]);
  using lease = await ctx.db.acquireRead();
  const itemTags = resolveItemTags(lease.client, item.itemID, new Map());
  const itemCollections = fetchItemCollections(
    new CollectionCache(),
    lease.client,
    item,
  );
  return selectableProfiles(ctx).map((profile) => {
    const { selector } = profile;
    let preparedPath: { path: string; canSuffix: boolean } | undefined;
    let unavailable: string | undefined;
    try {
      let reserved = options.reservedPaths?.get(selector);
      if (options.reservedPaths && !reserved) {
        reserved = new Set();
        options.reservedPaths.set(selector, reserved);
      }
      const document = resolveProfileDocument(ctx, profile);
      if (document === null)
        throw new Error(
          m.notice_literature_note_template_missing({
            document: profile.document!,
          }),
        );
      preparedPath = resolveNotePath(ctx, item, {
        itemTags,
        itemCollections,
        settings: profile.settings,
        document,
        reservedPaths: reserved,
      });
      reserved?.add(preparedPath.path);
      logger.debug("Prepared Profile creation path", {
        indexedKey: item.indexedKey,
        selector,
        path: preparedPath.path,
      });
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
      create: () => options.create(item, { profile: selector, preparedPath }),
    };
  });
}

async function prepareBatchCreationProfiles(
  ctx: NoteFeatureDeps,
  items: readonly Item[],
  options: {
    create: (
      item: Item,
      options: CreateNoteInternalOptions,
    ) => Promise<CreateNoteResult>;
    signal?: AbortSignal;
  },
): Promise<ReadonlyMap<number, readonly PreparedCreationProfile[]>> {
  const reservedPaths = new Map<ProfileSelector, Set<string>>();
  const plans = new Map<number, readonly PreparedCreationProfile[]>();
  for (const item of items) {
    options.signal?.throwIfAborted();
    plans.set(
      item.itemID,
      await prepareCreationProfiles(ctx, item, {
        create: options.create,
        reservedPaths,
      }),
    );
  }
  return plans;
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
 * Choose the Profile a new Literature Note is created under: the manual
 * choice, else the explicit input, else the first matching Profile Selection
 * Rule, else Default. An invalid explicit selector, an unevaluable in-scope
 * rule, or a matched rule with an unavailable target stops there with a
 * `problem` — the surface asks for an explicit choice instead of advancing
 * to a lower-priority source.
 */
async function resolveCreationProfile(
  ctx: NoteFeatureDeps,
  sources: CreationProfileSources = {},
): Promise<CreationProfileSelection> {
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.profile.ready,
  ]);
  const shouldAsk = ctx.profile.profiles.length > 0;
  const isAvailable = (selector: ProfileSelector) =>
    ctx.profile.resolveProfile(selector) !== undefined;
  const stopped = (problem: CreationSelectionProblem) => {
    logger.debug("Creation Profile selection stopped ({kind})", {
      kind: problem.kind,
      indexedKey: sources.item?.indexedKey,
    });
    return {
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
      problem,
    } as const;
  };
  let selection: CreationProfileSelection = {
    selector: DEFAULT_PROFILE,
    source: "bound",
    shouldAsk,
  };
  const explicit = (["asked", "headless"] as const).map((source) => ({
    source,
    selector: sources[source],
  }));
  const named = explicit.find(
    (
      entry,
    ): entry is { source: "asked" | "headless"; selector: ProfileSelector } =>
      entry.selector !== undefined,
  );
  if (named) {
    const { selector, source } = named;
    if (!isAvailable(selector))
      return stopped({ kind: "invalid-selector", source, selector });
    selection = { selector, source, shouldAsk };
  } else if (sources.item && settings["profile.selection-rules"].length > 0) {
    // The Item's actual memberships, read once from one snapshot: rules see
    // every Collection the Item is filed in, not the one a UI shows it under.
    using lease = await ctx.db.acquireRead();
    const result = selectProfileByRules(
      settings["profile.selection-rules"],
      ruleItem(
        sources.item,
        resolveMembershipFacts(lease.client, sources.item),
      ),
      { isAvailable },
    );
    switch (result.outcome) {
      case "matched":
        selection = {
          selector: result.selector,
          source: "rule",
          shouldAsk,
          rule: result.rule,
        };
        break;
      case "broken":
        return stopped({
          kind: "broken-rule",
          rule: result.rule,
          problem: result.problem,
        });
      case "unavailable-target":
        return stopped({
          kind: "unavailable-target",
          rule: result.rule,
          selector: result.selector,
        });
      case "unmatched":
        break;
    }
  }
  logger.debug("Resolved creation Profile {selector} from {source}", {
    selector: selection.selector,
    source: selection.source,
    rule: selection.rule?.id,
    indexedKey: sources.item?.indexedKey,
  });
  return selection;
}

function refusedCreate(
  indexedKey: string,
  existing: readonly TFile[],
): Extract<CreateNoteResult, { outcome: "refused" }> {
  const paths = existing.map((file) => file.path) as [string, ...string[]];
  return {
    outcome: "refused",
    diagnostic: {
      code:
        existing.length === 1
          ? "literature-note-exists"
          : "duplicate-literature-notes",
      hint:
        existing.length === 1
          ? "Open the existing Literature Note instead of creating another."
          : "Resolve the duplicate Literature Notes, then run create again.",
      indexedKey,
      paths,
    },
  };
}

/**
 * The bound feature serializes calls by Indexed Key before this operation.
 * This operation checks the settled Note Index before it writes. After that
 * check, `vault.create` is the atomic filename gate: on a collision, the name
 * is re-resolved with a forced `suffix()` and the write retried. Without a
 * `suffix()` marker there is nothing to disambiguate, so the collision
 * surfaces to the caller.
 *
 * @throws {@link EmptyFilenameError} when the rendered filename is empty, or an
 *   Obsidian vault error (e.g. a colliding path with no `suffix()` marker, or
 *   retries exhausted).
 */
async function createNote(
  ctx: OpsContext,
  item: Item,
  options: CreateNoteInternalOptions = {},
): Promise<CreateNoteResult> {
  const collectionCache = options.collectionCache ?? new CollectionCache();
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
    ctx.profile.ready,
  ]);
  const requestedProfile = options.profile ?? DEFAULT_PROFILE;
  const profile = ctx.profile.resolveProfile(requestedProfile);
  if (!profile) {
    return refusedUnknownProfile(requestedProfile, {
      indexedKey: item.indexedKey,
    });
  }
  if (conversionRequired(settings, requestedProfile)) {
    return refusedTemplateConversion(requestedProfile, {
      indexedKey: item.indexedKey,
    });
  }
  const existing = ctx.noteIndex.getNotesByItemKey(item.indexedKey);
  if (existing.length > 0) {
    if (existing.length === 1 && options.profile !== undefined) {
      const result = ctx.profile.profileOf(existing[0]!);
      if (!result.ok) {
        return refusedUnknownProfile(result.stamped.stamp, {
          indexedKey: item.indexedKey,
          path: existing[0]!.path,
        });
      }
      if (result.profile.selector !== requestedProfile) {
        return refusedProfileConflict(item.indexedKey, existing[0]!, {
          existingProfile: result.profile.selector,
          requestedProfile,
        });
      }
    }
    return refusedCreate(item.indexedKey, existing);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedMissingDocument(profile.document!, {
      indexedKey: item.indexedKey,
    });
  }
  // Pin the client across the async vault write and the child-note import flush
  // so an auto-refresh swap can't dispose it mid-operation; `lease.client` is
  // threaded through the helpers so they read one stable snapshot.
  using lease = await ctx.db.acquireRead();
  const username =
    options.username !== undefined
      ? options.username
      : getZoteroIdentity(lease.client).username;
  const itemTags = resolveItemTags(lease.client, item.itemID, tagMemo);
  const itemCollections = fetchItemCollections(
    collectionCache,
    lease.client,
    item,
  );
  let { path, canSuffix } =
    options.preparedPath ??
    resolveNotePath(ctx, item, {
      itemTags,
      itemCollections,
      settings: profile.settings,
      document,
    });

  for (let attempt = 0; ; attempt++) {
    let fileCreated = false;
    try {
      return await writeNewNote(ctx, item, {
        client: lease.client,
        tagMemo,
        collectionCache,
        path,
        settings: profile.settings,
        profile,
        document,
        groupIdMemo: options.groupIdMemo,
        username,
        onFileCreated: (created) => {
          fileCreated = true;
          options.onFileCreated?.(created);
        },
      });
    } catch (error) {
      if (
        fileCreated ||
        !isFileExistsError(error) ||
        !canSuffix ||
        attempt >= MAX_CREATE_RETRIES
      ) {
        throw error;
      }
      logger.debug("Filename collided on create; retrying with suffix", {
        path,
        attempt,
        itemKey: item.indexedKey,
      });
      ({ path, canSuffix } = resolveNotePath(ctx, item, {
        itemTags,
        itemCollections,
        settings: profile.settings,
        forceSuffix: true,
        document,
      }));
    }
  }
}

/**
 * Inner write step for {@link createNote}, which handles path resolution and
 * collision retries before calling here.
 *
 * @throws an Obsidian vault error (e.g. a file already exists at `path`).
 */
async function writeNewNote(
  ctx: OpsContext,
  item: Item,
  options: {
    client: NodeDatabaseClient;
    tagMemo: TagMemo;
    collectionCache: CollectionCache;
    path: string;
    settings: Readonly<Settings>;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    groupIdMemo?: GroupIDMemo;
    username: string | null;
    onFileCreated?: (file: TFile) => void;
  },
): Promise<CreateNoteResult> {
  const { tagMemo, collectionCache, path, settings } = options;
  await ensureParentFolder(ctx.app, path);

  const attachmentImport = await ctx.attachmentImport.prepare(path);
  const noteImport = await ctx.noteImport.prepare({
    client: options.client,
    sourcePath: path,
    settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport,
    noteImport,
    settings,
    sourcePath: path,
  });
  const context = fetchNoteContext(options.client, item, {
    resolvers,
    tagMemo,
    collectionCache,
    groupIdMemo: options.groupIdMemo,
    username: options.username,
  });
  const prepared = prepareFrontmatter({
    context,
    itemKey: item.indexedKey,
    document: options.document,
    diagnosticContext: { indexedKey: item.indexedKey },
  });
  if ("diagnostic" in prepared) {
    return { outcome: "refused", diagnostic: prepared.diagnostic };
  }
  const body = options.document
    ? options.document.renderForCreate(context)
    : ctx.template.render("note", context);
  const fm: Record<string, unknown> = {};
  applyFrontmatter(ctx, fm, {
    context,
    itemKey: item.indexedKey,
    profile: options.profile,
    prepared,
  });
  const content = `---\n${
    prepared.kind === "document"
      ? stringifyFrontmatterInOrder(fm, prepared.keys)
      : stringifyYaml(fm)
  }---\n${body}`;

  const file = await ctx.app.vault.create(path, content);
  options.onFileCreated?.(file);
  await attachmentImport.flush();
  await noteImport.flush();
  logger.debug("Created literature note", { path, itemKey: item.indexedKey });
  return { outcome: "created", file };
}

async function updateNote(
  ctx: OpsContext,
  file: TFile,
  options: {
    indexedKey: string;
    scope?: UpdateScope;
    profile?: ProfileSelector;
  },
): Promise<UpdateResult> {
  const { indexedKey, scope = "full" } = options;
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
    ctx.profile.ready,
  ]);
  await ctx.profile.ready;
  const existing = ctx.profile.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!ctx.profile.resolveProfile(requestedProfile)) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
    settings: profile.settings,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    noteImport,
    itemKey: indexedKey,
    scope,
    profile,
    document,
  });
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
    Temporal.Now.instant(),
  );
  if ("failures" in prepared)
    throw new Error(m.managed_frontmatter_refused_recovery());
  const properties: Record<string, unknown> = {};
  applyFrontmatter(ctx, properties, {
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
      let item: Item | undefined;
      {
        using lease = await ctx.db.acquireRead();
        const parsed = resolveIndexedKeyLibrary(lease.client, note.indexedKey);
        if (parsed)
          item = getItemsByKey(lease.client, parsed.libraryID, [parsed.key])[0];
      }
      if (!item) throw new Error(m.notice_protocol_item_not_found());
      return create(item, { profile: profile.selector, preparedPath });
    },
  };
}

async function prepareProfileSwitch(
  ctx: NoteFeatureDeps,
  file: TFile,
): Promise<PreparedProfileSwitch> {
  await Promise.all([ctx.profile.ready, ctx.settings.loaded]);
  const current = ctx.profile.profileOf(file);
  const cache = ctx.app.metadataCache.getFileCache(file);
  const imported = noteKeyFromFrontmatter(cache) !== null;
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (!imported && !indexedKey)
    throw new Error("The file is not a ZotLit note");
  const profiles = selectableProfiles(ctx).map((profile) => ({
    ...profilePreview(profile, profileSwitchPath(file, profile, { imported })),
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

async function switchNoteProfile(
  ctx: OpsContext,
  file: TFile,
  options: {
    profile: ProfileSelector;
    importedNotes?: readonly TFile[];
    move?: boolean;
  },
): Promise<UpdateResult> {
  const [, settings] = await Promise.all([
    ctx.profile.ready,
    ctx.settings.loaded,
    ctx.template.ready,
  ]);
  const selector = options.profile;
  const profile = ctx.profile.resolveProfile(selector);
  if (!profile) return refusedUpdateProfile(selector, file.path);
  if (conversionRequired(settings, selector)) {
    return refusedUpdateTemplateConversion(selector, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const previousPath = file.path;
  const imported =
    noteKeyFromFrontmatter(ctx.app.metadataCache.getFileCache(file)) !== null;
  const targetPath = profileSwitchPath(file, profile, { imported });
  const move = options.move && targetPath !== previousPath;
  if (move) {
    await ensureParentFolder(ctx.app, targetPath);
    await ctx.app.fileManager.renameFile(file, targetPath);
  }
  try {
    await stampNoteFamily(
      ctx,
      [file, ...(options.importedNotes ?? [])],
      profile.stamp,
    );
  } catch (error) {
    if (move) {
      try {
        await ctx.app.fileManager.renameFile(file, previousPath);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Profile switch and folder move rollback failed",
        );
      }
    }
    throw error;
  }
  logger.debug("Switched Literature Note Profile for the next update", {
    path: file.path,
    selector,
    importedNotes: options.importedNotes?.length ?? 0,
    moved: !!move,
  });
  return NO_BODY_UPDATE;
}

/** A switch keeps the existing name; only the target folder can change. */
function profileSwitchPath(
  file: TFile,
  profile: ResolvedProfile,
  options: { imported: boolean },
): string {
  return joinFolderPath(
    normalizeFolderPath(
      profile.bindings[
        options.imported ? "note.import-folder" : "note.literature-folder"
      ],
    ),
    file.name,
  );
}

async function getImportedNotesForItem(
  ctx: NoteFeatureDeps,
  indexedKey: string,
): Promise<TFile[]> {
  await ctx.noteIndex.whenIndexed();
  using lease = await ctx.db.acquireRead();
  const parsed = resolveIndexedKeyLibrary(lease.client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);
  const item = getItemsByKey(lease.client, parsed.libraryID, [parsed.key])[0];
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  return getChildNotesByParentIDs(lease.client, [item.itemID]).flatMap((note) =>
    ctx.noteIndex.getImportedNoteByNoteKey(note.indexedKey),
  );
}

async function stampNoteFamily(
  ctx: NoteFeatureDeps,
  files: readonly TFile[],
  stamp: string | undefined,
): Promise<void> {
  const previous = files.map(
    (file) =>
      [file, readProfileStamp(ctx.app.metadataCache, file)?.stamp] as const,
  );
  const attempted: typeof previous = [];
  try {
    for (const entry of previous) {
      attempted.push(entry);
      await stampNoteProfile(ctx, entry[0], stamp);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const [file, previousStamp] of attempted.toReversed()) {
      try {
        await stampNoteProfile(ctx, file, previousStamp);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Note Profile switch and rollback failed",
      );
    }
    throw error;
  }
}

/** Write one note's Profile stamp; `undefined` unstamps it as the default. */
async function stampNoteProfile(
  ctx: NoteFeatureDeps,
  file: TFile,
  stamp: string | undefined,
): Promise<void> {
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    if (stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
    else fm[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
  });
}

/**
 * Update an existing note from an already-fetched `item`. The batch runner
 * calls this to reuse the item it classified, skipping the per-item
 * resolution {@link updateNote} does via `indexedKey` (re-deriving the
 * library and re-querying the item).
 *
 * Assumes the caller has gated database, note-index, and template readiness;
 * the batch runner does so once for the whole run, so unlike {@link updateNote}
 * (via {@link contextForIndexedKey}) this does not await them itself.
 */
async function writeNoteUpdate(
  ctx: OpsContext,
  file: TFile,
  options: WriteNoteUpdateOptions,
): Promise<UpdateResult> {
  await ctx.profile.ready;
  const existing = ctx.profile.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!ctx.profile.resolveProfile(requestedProfile)) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(options.item.indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(options.settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const noteImport = await ctx.noteImport.prepare({
    client: options.client,
    sourcePath: file.path,
    settings: profile.settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo: options.tagMemo,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport,
    noteImport,
    settings: profile.settings,
    sourcePath: file.path,
  });
  const context = fetchNoteContext(options.client, options.item, {
    resolvers,
    tagMemo: options.tagMemo,
    collectionCache: options.collectionCache,
    groupIdMemo: options.groupIdMemo,
    username: options.username,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    noteImport,
    itemKey: options.item.indexedKey,
    scope: options.scope ?? "full",
    profile,
    document,
  });
}

/** Compose a managed update from its steps: prepare and refresh frontmatter,
 *  then for the `full` scope replace the managed body region. A document field
 *  refusal returns before either write. Shared by
 *  {@link updateNote} and {@link writeNoteUpdate}; the caller supplies the
 *  already-built context and its prepared `attachmentImport`. */
async function applyManagedUpdate(
  ctx: OpsContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    attachmentImport: Pick<AttachmentImport, "flush">;
    noteImport: Pick<NoteImport, "flush">;
    itemKey: string;
    scope: UpdateScope;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
  },
): Promise<UpdateResult> {
  const {
    context,
    attachmentImport,
    noteImport,
    itemKey,
    scope,
    profile,
    document,
  } = input;
  const diagnostic = await refreshFrontmatter(ctx, file, {
    context,
    itemKey,
    profile,
    document,
  });
  if (diagnostic) return { ...NO_BODY_UPDATE, diagnostic };
  const result =
    scope === "full"
      ? document
        ? await replaceDocumentManagedBody(ctx, file, {
            context,
            itemKey,
            document,
          })
        : await replaceManagedBody(ctx, file, { context, itemKey })
      : NO_BODY_UPDATE;

  await Promise.all([attachmentImport.flush(), noteImport.flush()]);

  logger.debug("Updated literature note", {
    path: file.path,
    itemKey,
    scope,
    bodyUpdated: result.bodyUpdated,
  });
  return result;
}

async function replaceDocumentManagedBody(
  ctx: NoteFeatureDeps,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    document: ResolvedLiteratureNoteTemplate;
  },
): Promise<UpdateResult> {
  const { context, itemKey, document } = input;
  if (!document.hasManagedBlock) {
    return { ...NO_BODY_UPDATE, noManagedBlock: true };
  }
  return replaceManagedBody(ctx, file, {
    context,
    itemKey,
    renderRegion: () => document.renderForUpdate(context)!,
  });
}

/** Replace the managed body region in place, re-rendering the `content`
 *  template. The engine's transformRender wraps `content` in the managed-region
 *  markers, so the render is already wrapped. */
async function replaceManagedBody(
  ctx: NoteFeatureDeps,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    renderRegion?: () => string;
  },
): Promise<UpdateResult> {
  const { context, itemKey, renderRegion } = input;
  let replaced = false;
  let duplicateCount = 0;
  await ctx.app.vault.process(file, (content) => {
    // replaceManagedRegion only invokes the provider when a region exists,
    // so rendering `content` — and the attachment imports its lazy imgLink
    // closures queue as a side effect — is skipped when there is no region.
    const result = replaceManagedRegion(content, () =>
      renderRegion ? renderRegion() : ctx.template.render("content", context),
    );
    replaced = result.replaced;
    duplicateCount = result.duplicateCount;
    return result.content;
  });

  if (duplicateCount > 0) {
    logger.warn("Literature note has duplicate managed regions", {
      path: file.path,
      itemKey,
      count: duplicateCount + 1,
    });
  }
  return { bodyUpdated: replaced, duplicateRegionCount: duplicateCount };
}

async function overwriteNote(
  ctx: OpsContext,
  file: TFile,
  indexedKey: string,
): Promise<UpdateResult> {
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
    ctx.profile.ready,
  ]);
  const result = ctx.profile.profileOf(file);
  if (!result.ok) return refusedUpdateProfile(result.stamped.stamp, file.path);
  const profile = result.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
    settings: profile.settings,
  });
  const diagnostic = await refreshFrontmatter(ctx, file, {
    context,
    itemKey: indexedKey,
    profile,
    document,
  });
  if (diagnostic) return { ...NO_BODY_UPDATE, diagnostic };
  const body = document
    ? document.renderForCreate(context)
    : ctx.template.render("note", context);
  await ctx.app.vault.process(file, (content) => {
    const prefix = FRONTMATTER_BLOCK.exec(content)?.[0] ?? "";
    return `${prefix}${body}`;
  });

  await Promise.all([attachmentImport.flush(), noteImport.flush()]);
  logger.info("Overwrote literature note", {
    path: file.path,
    itemKey: indexedKey,
  });
  return { bodyUpdated: true, duplicateRegionCount: 0 };
}

/**
 * Render the configured cite template for the given items. Synchronous (called
 * from `selectSuggestion`/`onChooseSuggestion` handlers, which can't await), so
 * it returns `null` instead of throwing when the template isn't loaded yet;
 * the caller shows a "still loading" notice in that case.
 *
 * @param secondary - render the bare `cite2` template (narrative/in-prose,
 *   e.g. `@key`) instead of the default bracketed `cite` template (`[@key]`).
 * @returns the rendered citation in inline form ({@link inlineCitation}).
 */
function renderCitation(
  ctx: NoteFeatureDeps,
  items: readonly CiteRef[],
  secondary = false,
): string | null {
  if (!ctx.template.loaded || !ctx.profile.loaded) return null;
  return inlineCitation(
    ctx.template.render(
      secondary ? "cite2" : "cite",
      citekeysToCiteTemplateData(items),
    ),
  );
}

/**
 * Render a single annotation through the `annotation` template for the annot
 * view's drag-insert. Synchronous (so it can populate `dataTransfer` during
 * `dragstart`): reads the sync `db` view off `ctx` and needs a pre-prepared
 * `attachmentImport` handle whose `flush()` the caller runs on drop. Only the
 * dragged annotation's template is rendered, so only its excerpt image is
 * queued for import. Returns `null` when the item or annotation can't be
 * resolved, the database is not ready, or the template is not ready.
 */
function renderAnnotation(
  ctx: SyncRenderDeps,
  annotationItemId: number,
  options: {
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
  },
): string | null {
  const { db } = ctx;
  if (db.state !== "ready") return null;
  if (!ctx.template.loaded || !ctx.profile.loaded) return null;
  const settings = ctx.settings.current;
  if (!settings) return null;

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  return (
    renderAnnotations(db.client, [annotation], {
      template: ctx.template,
      zoteroPref: ctx.zoteroPref,
      attachmentImport: options.attachmentImport,
      renderAnnotation: (data) => {
        const indexedKey = data.parentItem?.indexedKey;
        const file = indexedKey
          ? ctx.noteIndex.getNotesByItemKey(indexedKey)[0]
          : undefined;
        const resolved: NoteProfile = file
          ? ctx.profile.profileOf(file)
          : ctx.profile.profileOf();
        if (!resolved.ok) {
          throw new ProfileAnnotationError(
            unknownProfileDiagnostic(resolved.stamped.stamp, {
              path: file?.path,
              indexedKey,
            }),
          );
        }
        return ctx.template.renderProfileAnnotation(data, {
          profile: resolved.profile,
        });
      },
    }).get(annotation.key) ?? null
  );
}

/**
 * Render an annotation's page-pinned citation for the annot view's "Copy
 * citation" action: the same `cite`-template path {@link renderAnnotation}'s
 * `zt.citation` field uses, called directly (no excerpt image import needed
 * for a citation string, so the `attachmentImport` port is stubbed).
 * Returns `null` when the annotation, its parent item, or the parent's
 * citation key can't be resolved, or the database/template isn't ready.
 */
function renderAnnotationCitation(
  ctx: SyncRenderDeps,
  annotationItemId: number,
): string | null {
  const { db } = ctx;
  if (db.state !== "ready") return null;
  if (!ctx.template.loaded || !ctx.profile.loaded) return null;

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  const resolvers = buildAnnotationResolvers({
    zoteroPref: ctx.zoteroPref,
    attachmentImport: {
      decide: (path, origin) => ({
        approved: false,
        path,
        origin,
        reason: "no-trusted-root",
      }),
      resolveLink: () => () => "",
    },
  });
  const data = fetchAnnotationsTemplateData(db.client, [annotation], {
    resolvers,
  }).get(annotation.key);
  if (!data) return null;

  return annotationCitation(data.parentItem, data.pageLabel, ctx.template);
}

/**
 * Assumes the caller has settled note-index and template readiness (and pinned
 * the client via `acquireRead`); {@link updateNote} and {@link overwriteNote} do
 * so before acquiring the lease. `template.ready` in particular gates
 * `refreshFrontmatter`, which reads `template.frontmatterFields` and writes
 * before `render()` would throw — without it, an early update could strip
 * managed frontmatter to the still-empty compiled fields.
 */
async function contextForIndexedKey(
  ctx: NoteFeatureDeps,
  indexedKey: string,
  options: {
    client: NodeDatabaseClient;
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    sourcePath: string;
    settings: Readonly<Settings>;
  },
): Promise<{ context: NoteTemplateContext; noteImport: NoteImport }> {
  const { client, sourcePath, settings } = options;
  const parsed = resolveIndexedKeyLibrary(client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

  const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  const noteImport = await ctx.noteImport.prepare({
    client,
    sourcePath,
    settings,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport: options.attachmentImport,
    noteImport,
    settings,
    sourcePath,
  });
  const context = fetchNoteContext(client, item, {
    resolvers,
    tagMemo: new Map(),
    collectionCache: new CollectionCache(),
    username: getZoteroIdentity(client).username,
  });
  return { context, noteImport };
}

async function refreshFrontmatter(
  ctx: OpsContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
  },
): Promise<ManagedFrontmatterRefusalDiagnostic | undefined> {
  const prepared = prepareFrontmatter({
    context: input.context,
    itemKey: input.itemKey,
    document: input.document,
    diagnosticContext: { path: file.path },
  });
  if ("diagnostic" in prepared) return prepared.diagnostic;
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    applyFrontmatter(ctx, fm, { ...input, prepared });
  });
}

function prepareFrontmatter(input: {
  context: NoteTemplateContext;
  itemKey: string;
  document: ResolvedLiteratureNoteTemplate | undefined;
  diagnosticContext: { path?: string; indexedKey?: string };
}):
  | PreparedManagedFrontmatter
  | { diagnostic: ManagedFrontmatterRefusalDiagnostic } {
  const frontmatter = input.document?.frontmatter;
  const result = prepareManagedFrontmatter(
    frontmatter,
    input.context,
    Temporal.Now.instant(),
  );
  if ("prepared" in result) return result.prepared;

  const failures = result.failures.map(({ key: field, reason, error }) => {
    if (reason === "evaluation") {
      logger.warn("Managed Frontmatter field failed", {
        key: field,
        itemKey: input.itemKey,
        error,
      });
      return {
        field,
        message: m.managed_frontmatter_eval_failure({ field }),
        hint: m.managed_frontmatter_eval_recovery({ field }),
      };
    }
    return {
      field,
      message: m.managed_frontmatter_inert_failure({ field }),
      hint: m.managed_frontmatter_inert_recovery({ field }),
    };
  }) as [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  return {
    diagnostic: {
      code: "managed-frontmatter-refused",
      hint: m.managed_frontmatter_refused_recovery(),
      failures,
      ...input.diagnosticContext,
    },
  };
}

/** Apply one prepared document patch or the legacy settings-held field set. */
function applyFrontmatter(
  ctx: OpsContext,
  fm: Record<string, unknown>,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    profile: ResolvedProfile;
    prepared: PreparedManagedFrontmatter;
  },
): void {
  const { context, itemKey, profile, prepared } = input;
  const failed: string[] = [];
  const onConflict = (key: string, detail: { reason: "shape-mismatch" }) => {
    logger.warn("Skipped frontmatter append", { key, itemKey, ...detail });
  };
  if (prepared.kind === "document") {
    applyDocumentManagedFrontmatter(fm, context, { prepared, onConflict });
  } else {
    applyManagedFrontmatter(fm, context, {
      compiled: ctx.template.frontmatterFields,
      onError: (key, error) => {
        failed.push(key);
        logger.warn("Frontmatter expression failed", { key, itemKey, error });
      },
      onConflict,
    });
  }
  if (failed.length > 0) {
    ctx.events.emit("frontmatter-eval-failed", { itemKey, fields: failed });
  }
  if (profile.stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
  else fm[FIELD_LITERATURE_NOTE_PROFILE] = profile.stamp;
  if (profile.citationStyle == null) delete fm[FIELD_CITATION_STYLE];
  else fm[FIELD_CITATION_STYLE] = profile.citationStyle;
}

/** A type guard: when conversion is pending, a non-default selector is a real Profile ID. */
function conversionRequired(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
): selector is ProfileId {
  return (
    settings["note.template-conversion-pending"] && selector !== DEFAULT_PROFILE
  );
}

function resolveProfileDocument(
  ctx: NoteFeatureDeps,
  profile: ResolvedProfile,
): ResolvedLiteratureNoteTemplate | undefined | null {
  if (profile.document === undefined) return undefined;
  return ctx.template.getLiteratureNoteTemplate(profile.document) ?? null;
}

function refusedUnknownProfile(
  stamp: string,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: UnknownProfileDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: unknownProfileDiagnostic(stamp, context),
  };
}

function refusedUpdateProfile(stamp: string, path: string): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedUnknownProfile(stamp, { path }).diagnostic,
  };
}

function refusedMissingDocument(
  document: string,
  context: { path?: string; indexedKey?: string },
): { outcome: "refused"; diagnostic: MissingLiteratureNoteTemplateDiagnostic } {
  return {
    outcome: "refused",
    diagnostic: {
      code: "missing-literature-note-template",
      hint: `Restore '${document}' in the template folder or clear the Profile document reference.`,
      document,
      ...context,
    },
  };
}

function refusedUpdateMissingDocument(
  document: string,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedMissingDocument(document, { path }).diagnostic,
  };
}

function refusedTemplateConversion(
  profileId: ProfileId,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: LiteratureNoteTemplateConversionRequiredDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-template-conversion-required",
      hint: "Convert the legacy Literature Note Templates before using added Profiles.",
      profileId,
      ...context,
    },
  };
}

function refusedUpdateTemplateConversion(
  profileId: ProfileId,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedTemplateConversion(profileId, { path }).diagnostic,
  };
}

function refusedUpdateProfileConflict(
  indexedKey: string,
  path: string,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Follow the stamped Profile, or switch the note interactively before this headless update.",
      indexedKey,
      path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}

function refusedProfileConflict(
  indexedKey: string,
  file: TFile,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): Extract<CreateNoteResult, { outcome: "refused" }> {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Keep the existing Profile, or switch the note to the requested Profile and refresh its managed content.",
      indexedKey,
      path: file.path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}
