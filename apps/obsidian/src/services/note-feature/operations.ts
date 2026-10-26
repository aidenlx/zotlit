import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type { ProfileSelector } from "@/lib/profile-stamp";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

import type { NoteCitations } from "./citations-handle";
import type { NoteFeatureDeps } from "./context";
import {
  planCreations,
  prepareProfileNote,
  prepareProfileSwitch,
  resolveCompanionNote,
  resolveCreationProfile,
} from "./creation-planning";
import { refusedCreate } from "./diagnostics";
import type {
  CompanionNoteTarget,
  CreateNoteInternalOptions,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlan,
  CreationPlanOptions,
  CreationProfileSelection,
  CreationProfileSources,
  NoteFeatureEvents,
  OpsContext,
  PreparedProfileSwitch,
  ProfileNotePreview,
  ProfileNotePreviewOptions,
  UpdateResult,
  WriteNoteUpdateOptions,
} from "./types";
import {
  createNote,
  getImportedNotesForItem,
  overwriteNote,
  replacedKeys,
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

const MAX_UNINDEXED_CREATES = 256;

/**
 * The bound note-feature operations returned by {@link createNoteFeature}.
 * Consumers hold this object; the collaborators stay behind the seam.
 */
export interface NoteFeature extends NoteCitations {
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
    // Until the Note Feature is a tag, the citation members run on the bridge.
    renderCitation: (items, variant) =>
      deps.citations.renderCitation(items, variant),
    renderAnnotationCitation: (annotationKey) =>
      deps.citations.renderAnnotationCitation(annotationKey),
    prepareAnnotationInsert: (options) =>
      deps.citations.prepareAnnotationInsert(options),
    on: (event, cb) => events.on(event, cb),
  };
}
