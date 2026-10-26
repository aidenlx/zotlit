import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";

import type { ProfileSelector } from "@/lib/profile-stamp";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";

import type { NoteCitations } from "./citations-handle";
import type { NoteCreation } from "./creation-handle";
import type {
  CreateNoteOptions,
  CreateNoteResult,
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
  prepareProfileNote(options: ProfileNotePreviewOptions): ProfileNotePreview;
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
  /** Imported Notes currently materialized for one Zotero item. */
  getImportedNotesForItem(indexedKey: string): Promise<TFile[]>;
  /** @see replacedKeys */
  replacedKeys(file: TFile): Promise<ReadonlySet<string>>;
  /** @see createNote */
  createNote(
    item: Item,
    options?: CreateNoteOptions,
  ): Promise<CreateNoteResult>;
  /** @see overwriteNote */
  overwriteNote(
    file: TFile,
    indexedKey: string,
    options?: { outcomes?: ExcerptOutcomeScope },
  ): Promise<UpdateResult>;
}
