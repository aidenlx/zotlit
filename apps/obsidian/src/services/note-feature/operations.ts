import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";

import type { ProfileSelector } from "@/lib/profile-stamp";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";

import type { NoteCitations } from "./citations-handle";
import type { NoteCreation } from "./creation-handle";
import type {
  CompanionNoteTarget,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlan,
  CreationPlanOptions,
  CreationProfileSelection,
  CreationProfileSources,
  NoteFeatureEvents,
  PreparedProfileSwitch,
  ProfileNotePreview,
  ProfileNotePreviewOptions,
  UpdateResult,
} from "./types";

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

/**
 * The Note Feature for callers outside Effect, as `bindNoteFeature` builds it
 * over the `NoteFeature` tag.
 */
export interface NoteFeatureHandle extends NoteCitations, NoteCreation {
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
  /** Subscribe to {@link NoteFeatureEvents}; returns an unsubscribe. */
  on<K extends keyof NoteFeatureEvents>(
    event: K,
    cb: NoteFeatureEvents[K],
  ): () => void;
}
