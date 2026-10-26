import type { TFile } from "obsidian";

import type { Item, NoteTemplateContext } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";
import type { Emitter } from "@zotlit/shared/nanoevents";

import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import type { NoteFeatureDeps } from "./context";

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

/** The note stopped carrying the Indexed Key the update rendered for. */
export interface NoteKeyChangedDiagnostic {
  code: "literature-note-key-changed";
  hint: string;
  indexedKey: string;
  path: string;
}

/** The note's stamp stopped naming the Profile the update rendered under. */
export interface NoteProfileChangedDiagnostic {
  code: "literature-note-profile-changed";
  hint: string;
  indexedKey: string;
  path: string;
}

export type NoteOperationDiagnostic =
  | UnknownProfileDiagnostic
  | NoteProfileConflictDiagnostic
  | MissingLiteratureNoteTemplateDiagnostic
  | LiteratureNoteTemplateConversionRequiredDiagnostic
  | ManagedFrontmatterRefusalDiagnostic
  | NoteKeyChangedDiagnostic
  | NoteProfileChangedDiagnostic;

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
}

export interface CreationPlanOptions extends CreationProfileSources {
  /** Stops the plan at its next read; the plan then rejects. */
  signal?: AbortSignal;
}

/** How one Indexed Key's note would be created. */
export interface CreationPlan {
  /** The Snapshot's Item; `undefined` when the Snapshot lacks the key. */
  item: Item | undefined;
  /** The Profile the sources or the Item's Profile Match select. */
  selection: CreationProfileSelection;
  /** Each selectable Profile's preview; none without an Item. */
  previews: readonly PreparedCreationProfile[];
}

/** Manual choice, explicit operation input, Profile Match, then Default. */
export type CreationProfileSource = "asked" | "headless" | "match" | "bound";

export type CreationSelectionProblem =
  | { kind: "overlap"; candidates: readonly LiteratureNoteProfile[] }
  | { kind: "unavailable-profile"; selector: ProfileSelector }
  | {
      kind: "invalid-selector";
      source: Extract<CreationProfileSource, "asked" | "headless">;
      selector: ProfileSelector;
    };

export type CreationProfileSelection = {
  selector: ProfileSelector;
  shouldAsk: boolean;
  problem?: CreationSelectionProblem;
} & (
  | { source: "match"; reason: string }
  | { source: "asked" | "headless" | "bound"; reason?: undefined }
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
  create: (
    options?: Pick<CreateNoteOptions, "reportExcerpts" | "outcomes" | "reads">,
  ) => Promise<CreateNoteResult>;
}

export interface ProfileNotePreview {
  path: string;
  body: string;
  properties: Record<string, unknown>;
  create: () => Promise<CreateNoteResult>;
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

/** Per-batch inputs threaded through a multi-item create run. */
export interface CreateNoteOptions {
  /** A batch collects used outcomes here and reports once when the run settles. */
  reportExcerpts?: (summary: ExcerptSummary) => void;
  /**
   * The initiating batch's retained outcomes. Omitted, this create opens its
   * own scope for the note it writes, then releases it once the note settles.
   */
  outcomes?: ExcerptOutcomeScope;
  /**
   * The initiating batch's Snapshot-bound reads. Omitted, this create opens its
   * own Snapshot for the render and the write.
   */
  reads?: ZoteroReadsApi;
  /**
   * The account username; omitted, the create reads the signed-in account
   * from its Snapshot.
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
  preparedPath?: { path: string };
}

/**
 * Batch-threaded write: the caller owns the run-wide lease and passes its
 * Snapshot-bound `reads`, so no per-item lease re-acquisition.
 */
export interface WriteNoteUpdateOptions {
  reportExcerpts?: (summary: ExcerptSummary) => void;
  reads: ZoteroReadsApi;
  item: Item;
  settings: Readonly<Settings>;
  scope?: UpdateScope;
  /** The account username; omitted, the update reads the signed-in account. */
  username?: string | null;
  /** Headless explicit Profile. A different stamp is refused. */
  profile?: ProfileSelector;
  /**
   * The initiating batch's retained outcomes, shared with every other note the
   * batch writes.
   */
  outcomes?: ExcerptOutcomeScope;
}

/** Events the bound note feature emits; a UI subscriber owns any rendering. */
export interface NoteFeatureEvents {
  "excerpt-images-reported": (summary: ExcerptSummary) => void;
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

export type { CreateNoteInternalOptions, OpsContext };
