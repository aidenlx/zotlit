// The records, sources, drafts, events and write types the Annotation Repository core's parts share, with their shared pure helpers.
import type { Mutation, QueryKey } from "@tanstack/query-core";
import type { Effect } from "effect";

import { tagTypeToName } from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  Attachment,
  Library,
  ResolvedAnnotationTypeName,
  TemplateTag,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { LegacyPortError } from "@/lib/legacy-port";
import type { FieldHistoryStep } from "@/services/annotation-repository/history";
import type {
  AnnotationLock,
  LockReason,
} from "@/services/annotation-repository/lock";
import { storedPosition } from "@/services/annotation-repository/reconcile";
import {
  annotationTags,
  commentPatch,
  isTextField,
  TEXT_FIELDS,
  textPatch,
} from "@/services/annotation-repository/write";
import type {
  AnnotationTag,
  ConflictedWrite,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "@/services/annotation-repository/write";
import type { QueryClients } from "@/services/query-client/service";
import type {
  LocalApiAnnotation,
  LocalApiSource,
  ZoteroLocalApi,
} from "@/services/zotero-local-api/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

/** The namespace this repository owns on the plugin-wide query client. */
const ANNOTATIONS = "annotations";

/**
 * Where a whole record set came from. The source is atomic per Attachment: a
 * list is wholly one source's, and the two sets never join.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 */
export interface DatabaseAnnotationSource {
  kind: "zotero-db";
  /** Standalone database identity, available before a Local API Server ID. */
  database: {
    userID: number | null;
    localUserKey: string | null;
    serverID: string | null;
  };
  libraryID: number;
  /** Committed Zotero Library revision held by this database snapshot. */
  libraryRevision: number | null;
}

export type AnnotationSource = DatabaseAnnotationSource | LocalApiSource;

/**
 * One Annotation as both sources describe it: Indexed Keys, a type name, and a
 * position already narrowed out of its stored JSON. The numeric SQLite item id
 * and the parent's content type stay inside the Zotero DB read path.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export interface AnnotationRecord {
  /** Indexed Key: the bare key for the personal library, `KEYgGROUPID` for a group. */
  key: string;
  type: ResolvedAnnotationTypeName;
  /** Hex colour code, e.g. `"#ffd400"`. */
  color: string | null;
  comment: string | null;
  text: string | null;
  /** The Attachment this Annotation hangs from, by Indexed Key. */
  parentKey: string;
  /** Zotero's printed-page label, as Zotero stored it. */
  pageLabel: string | null;
  /**
   * The Sort Index Zotero stores. It orders the list, an undone Geometry Edit
   * puts it back beside the position it was computed from, and a restore sends
   * it back: Zotero's create demands one and computes none.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  sortIndex: string;
  /**
   * The Annotation's Zotero tags, by name. Names rather than the numeric tag
   * ids SQLite keeps, because a name is what both sources can supply.
   */
  tags: readonly string[];
  /**
   * The same tags with the type Zotero stores for each, which a tag write
   * sends back. Both sources fill it; a record without it holds manual tags.
   */
  tagDetails?: readonly AnnotationTag[];
  /** Parsed once per read, so a redraw parses nothing. */
  position: AnnotationPosition;
  /**
   * The object version this read answered, which a write sends back as its
   * precondition. `null` under a source that keeps no versions — the Zotero DB
   * partition, where a write is refused before any request for exactly that
   * reason.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  version: number | null;
  /**
   * The lock Zotero's reader puts on this Annotation, or `null` where it has
   * none. Both sources read it from the Zotero database, since the Local API
   * sends no lock facts, and every list the repository answers carries the
   * locks the database last gave; an Annotation the database does not hold
   * yet has none.
   *
   * @see apps/obsidian/docs/adr/0067-annotation-locks-come-from-the-zotero-database.md
   */
  lock: AnnotationLock | null;
  /** Source facts used by annotation templates; absent facts stay unknown. */
  templateMetadata?: {
    dateAdded: string | null;
    dateModified: string | null;
    authorName: string | null;
    isExternal: boolean | null;
    tags?: readonly Pick<TemplateTag, "name" | "type">[];
  };
}

/** One Attachment's Annotations, beside the source that answered for them. */
export interface AnnotationList {
  source: AnnotationSource;
  /** In Zotero's own reading order. */
  annotations: readonly AnnotationRecord[];
}

export type TextFieldDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "conflict"; fresh: string }
  | { kind: "failed"; failure: WriteFailure };

/**
 * One text field of an Annotation Draft, typed in this plugin session and
 * autosaved on a typing pause.
 */
export interface TextFieldDraft {
  annotationKey: string;
  attachmentKey: string;
  /** Zotero database that supplied the record when editing began. */
  serverID: string;
  /** Confirmed value editing began from. */
  baseline: string;
  /** Current shared input. */
  text: string;
  state: TextFieldDraftState;
  /**
   * The next save requires an explicit action: set after a failed or
   * unconfirmed write, or when editing is lost while this draft is open.
   */
  manualSave?: boolean;
}

export type TagDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "failed"; failure: WriteFailure };

/**
 * The tag field of one Annotation Draft: one tag editing session, shared by
 * every surface. It is saved once, when the editor closes.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export interface TagDraft {
  annotationKey: string;
  attachmentKey: string;
  /** Zotero database that supplied the record when the session began. */
  serverID: string;
  /** Confirmed tag names the session started from. */
  baseline: readonly string[];
  /** Current names in the shared editor. */
  names: readonly string[];
  /** `pending` while the save is in flight, which the editor shows as saving. */
  state: TagDraftState;
  /**
   * The next save requires Save tags: set after a failed or unconfirmed
   * write, or when editing is lost while this draft is open.
   */
  manualSave?: boolean;
  /**
   * The session ended with no write, and the draft waits for Save tags. No
   * editor holds it open, so a surface may offer Save tags without cutting a
   * session short.
   */
  held?: boolean;
}

/**
 * How one text field reads from a record and writes to Zotero. The field's
 * name is also the write's name, which its Write Conflict carries.
 */
interface TextFieldSpec {
  valueOf: (record: AnnotationRecord) => string | null;
  request: (target: WriteTarget, value: string) => WriteRequest;
  propose: (value: string) => ProposedFields;
}

/**
 * The draft fields typed as text and autosaved on a typing pause. A field
 * added here is drafted, saved, reconciled, and conflicted like the comment.
 */
const TEXT_FIELD_SPECS = {
  comment: {
    valueOf: (record) => record.comment,
    request: commentPatch,
    // Zotero stores an empty comment as no value.
    propose: (value) => ({ comment: value === "" ? null : value }),
  },
  // The Quoted Text of a highlight or underline. A Text Edit sends the text
  // alone: the position and the Sort Index stay as they are.
  text: {
    valueOf: (record) => record.text,
    request: textPatch,
    // Zotero stores an empty Quoted Text as no value.
    propose: (value) => ({ text: value === "" ? null : value }),
  },
} satisfies Record<TextField, TextFieldSpec>;

/**
 * The fields an Annotation Draft stands on. Each Annotation has at most one
 * draft per field, and each field's draft saves, conflicts, and is held on its
 * own.
 *
 * @see apps/obsidian/docs/adr/0048-annotation-drafts-and-pending-writes-stay-in-memory.md
 */
type DraftFields = { [F in TextField]: TextFieldDraft } & { tags: TagDraft };

type DraftField = keyof DraftFields;

const DRAFT_FIELDS: readonly DraftField[] = [...TEXT_FIELDS, "tags"];

/** One map per field, keyed by string, with each field's own value type. */
type FieldMaps<F extends string, V extends Record<F, unknown>> = {
  [K in F]: Map<string, V[K]>;
};

function fieldMaps<F extends string, V extends Record<F, unknown>>(
  fields: readonly F[],
): FieldMaps<F, V> {
  return Object.fromEntries(
    fields.map((field) => [field, new Map()]),
  ) as FieldMaps<F, V>;
}

/**
 * Everything the repository holds about one Annotation beside its record, as
 * one snapshot: a surface re-reads it whole on `annotation-changed`.
 */
export interface AnnotationState {
  /** What a write left on it; `pending` while one stands. */
  mutation: MutationState;
  /** Its comment and Quoted Text drafts in the active Zotero database. */
  textDrafts: Readonly<Record<TextField, TextFieldDraft | null>>;
  /** Its tag draft in the active Zotero database. */
  tagDraft: TagDraft | null;
  /**
   * A draft on it stands in another Zotero database, which hides it here: a
   * surface closes the editor that drew it, with nothing to save.
   */
  hidden: boolean;
  /** A complete read confirmed it no longer exists. */
  gone: boolean;
}

export type AnnotationRepositoryEvent =
  /**
   * The list this Attachment holds was superseded. A consumer re-reads and
   * replaces the whole list; nothing patches a list in place.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  | {
      _tag: "annotations-changed";
      attachmentKey: string;
    }
  /**
   * One Annotation's pixels moved: its geometry or its ink appearance decides
   * what an Excerpt Image crops and paints, while a comment, a tag, or a label
   * leaves the pixels as they were and says nothing here.
   *
   * A display holding an image of the previous pixels replaces it against this
   * record. A write this repository confirmed answers with the record Zotero
   * holds, so a consumer needs no list re-read to know the new pixels; an edit
   * saved in Zotero itself is what a later read, compared against the list that
   * stood before it — or, for the first read of a session, against the image
   * this device persists for the Annotation — finds and announces here.
   *
   * @param record the saved Annotation, whose `parentKey` names its Attachment.
   * @param source the Annotation Source the record was read or written through,
   *   which is what a consumer needs to resolve the record's files again.
   * @see apps/obsidian/docs/adr/0055-reader-edits-revalidate-excerpt-images.md
   */
  | {
      _tag: "excerpt-pixels-changed";
      record: AnnotationRecord;
      source: AnnotationSource;
    }
  /**
   * What a surface may do to an Attachment's Annotations moved. Every consumer
   * re-reads {@link AnnotationRepository.capabilityFor}; no record set is
   * affected, so nothing re-reads a list for this.
   */
  | { _tag: "capability-changed" }
  /**
   * Something the repository holds about one Annotation beside its record
   * moved: what a write left on it, its Annotation Draft, whether a database
   * switch hid that draft, or whether it is gone. A consumer re-reads the whole
   * {@link AnnotationRepository.annotationState} at once; the record itself
   * moves with `annotations-changed`.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  | {
      _tag: "annotation-changed";
      annotationKey: string;
    }
  /**
   * One Attachment's Annotation History opened, closed, or moved. A consumer
   * that draws whether an undo or a redo stands re-reads
   * {@link AnnotationRepository.canUndo} and
   * {@link AnnotationRepository.canRedo}; no record set is affected.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  | {
      _tag: "history-changed";
      attachmentKey: string;
    }
  /**
   * Zotero's copy of this Annotation moved under a write, and the card now
   * carries both values with the verbs that resolve them. Raised only for a
   * conflict the user must answer: an equal fresh value settles silently and
   * says nothing.
   *
   * The seam that hears this is the one that opens the Annotation View on the
   * card where no view is showing it.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @param attachmentKey the Attachment it hangs from.
   */
  | {
      _tag: "write-conflict";
      annotationKey: string;
      attachmentKey: string;
    };

export interface AnnotationRepositoryCoreDeps {
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  db: Pick<ZoteroReads["Service"], "snapshot" | "events" | "refresh">;
  queryClient: Pick<
    QueryClients["Service"],
    "client" | "invalidate" | "keysUnder" | "peek" | "read"
  >;
  localApi: Pick<
    ZoteroLocalApi["Service"],
    | "authorizedSend"
    | "changes"
    | "demandSource"
    | "listAnnotations"
    | "probe"
    | "readAnnotation"
    | "state"
    | "writeStateFor"
  >;
  /**
   * The write token each create carries.
   *
   * @default a fresh 32-character token per create
   */
  writeToken?: () => string;
  /**
   * The canonical pixel fingerprint of the Excerpt Image this device persists
   * for one Annotation — the display's own stored-outcome read — or `null`
   * where this device holds none.
   *
   * A session's first read of an Attachment has no list that stood before it,
   * so this is the baseline it is compared against instead: an edit saved in
   * Zotero while ZotLit was not running still announces the Annotation whose
   * pixels the image this device carries was made from. An Annotation it never
   * cached answers `null`, which says nothing and leaves it on demand.
   */
  persistedExcerpt?: (
    annotation: AnnotationRecord,
    source: AnnotationSource,
  ) => Effect.Effect<string | null, LegacyPortError>;
  publish: (event: AnnotationRepositoryEvent) => void;
}

/** One Annotation, beside the held list a write reads and replaces it in. */
interface HeldAnnotation {
  queryKey: QueryKey;
  /** The Attachment's Indexed Key, which the record itself names. */
  attachmentKey: string;
  record: AnnotationRecord;
}

/** What one command asks Zotero for, which a conflict puts beside the fresh record. */
type WriteAttempt =
  | { write: Exclude<ConflictedWrite, "geometry">; attempted: string | null }
  | { write: "geometry"; attempted: GeometryEdit; input: GeometryInput }
  /** `session` marks a tag editing session's own save, not a tag undo or redo. */
  | { write: "tags"; session?: true };

/** The write, and so the field, a standing outcome belongs to. */
type OutcomeWrite = WriteAttempt["write"];

type ConfirmedWrite =
  | {
      kind: "record";
      record: AnnotationRecord;
      write: "color" | "geometry" | "tags" | TextField;
    }
  | { kind: "created"; record: AnnotationRecord }
  | {
      kind: "deleted";
      annotationKey: string;
      /**
       * The Lock Reason the Annotation stood under when its delete was sent,
       * which a restore does not give back; absent where it had no lock.
       */
      lock?: LockReason;
    };

/** A version read back from Zotero also supersedes older collection reads. */
type AnnotationConfirmation =
  | ConfirmedWrite
  | { kind: "observed"; record: AnnotationRecord };

/** One write of a group that landed, held until the whole group settles. */
interface GroupWrite {
  attachmentKey: string;
  /** The held record the write was sent against. */
  before: AnnotationRecord;
  /** What Zotero answered the write with. */
  applied: ConfirmedWrite;
}

/**
 * The kind of History Step a group records: a group of deletes, or a group
 * of recolours.
 */
type GroupKind = Extract<FieldHistoryStep["kind"], "existence" | "color">;

/** Where the writes of one group put what they landed. */
interface GroupWrites {
  /** The one kind of step every write of the group joins. */
  kind: GroupKind;
  writes: GroupWrite[];
}

/** The fields a write in flight proposes, as Zotero will answer them. */
type ProposedFields = Partial<
  Pick<
    AnnotationRecord,
    | "color"
    | "comment"
    | "tags"
    | "tagDetails"
    | "position"
    | "sortIndex"
    | "text"
  >
>;

/**
 * What one write in flight proposes for its Annotation: its mutation's
 * variables, which every published list draws in place of the confirmed fields
 * until the write settles.
 */
interface PendingProposal {
  annotationKey: string;
  attachmentKey: string;
  /** The Zotero database the write goes to; another's list draws none of it. */
  serverID: string | null;
  fields: ProposedFields;
}

type AnnotationMutation = Mutation<
  MutationState,
  Error,
  PendingProposal | null
>;

/** One Annotation's or Attachment's key within one Zotero database. */
function indexedID(serverID: string, key: string): string {
  return `${serverID}\0${key}`;
}

/** The text one write in flight proposes for a text field. */
function proposedText(
  field: TextField,
  mutation: AnnotationMutation,
): string | null {
  return mutation.state.variables?.fields[field] ?? null;
}

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "") === (b ?? "");
}

/** What Zotero holds now for the field one refused write asked to change. */
function freshValueOf(
  record: AnnotationRecord,
  write: ConflictedWrite | "tags",
): string | null {
  if (isTextField(write)) return record[write];
  switch (write) {
    case "color":
      return record.color;
    // A delete names no value, so there is nothing to put beside the user's
    // input; the fresh card itself is what "Delete anyway" is asked against.
    case "delete":
      return null;
    // The stored position and the quoted text, as one comparable value.
    case "geometry":
      return JSON.stringify([storedPosition(record.position), record.text]);
    case "tags":
      return JSON.stringify(annotationTags(record));
  }
}

/** A merged tag list as the record Zotero answers after the write holds it. */
function proposedTags(tags: readonly AnnotationTag[]): ProposedFields {
  return { tags: tags.map(({ name }) => name), tagDetails: tags };
}

/**
 * The Zotero DB read path, and the only place the numeric item id and the
 * parent's content type are read: `parseAnnotationPosition` narrows the stored
 * JSON by the Attachment's content type, which the Annotation row itself
 * does not carry.
 *
 * @returns an empty list for a key the database does not hold, so an index that
 *   named an Attachment the database has since dropped reads as no Annotations
 *   rather than as a failure.
 */
/** One Attachment's answer from a batch read of the Zotero database. */
interface DatabaseAnswer {
  readonly found: {
    readonly attachment: Attachment | null;
    readonly annotations: readonly Annotation[];
    readonly accountUserID: number | null;
  };
  readonly libraries: readonly Library[];
  readonly database: ZoteroDatabaseIdentity;
}

/** Tags with their types named, as a template reads them from either source. */
function templateTags(tags: readonly AnnotationTag[] | undefined) {
  return tags?.map(({ name, type }) => ({ name, type: tagTypeToName(type) }));
}

/**
 * The Sort Index comes across: it orders the list, and a restore sends it back.
 * The Local API sends no lock facts, so the record carries no lock; a list read
 * puts the database's lock on it.
 */
function fromLocalApi({
  key,
  type,
  color,
  comment,
  text,
  parentKey,
  pageLabel,
  sortIndex,
  tags,
  position,
  version,
  dateAdded,
  dateModified,
  authorName,
  isExternal,
  tagDetails,
}: LocalApiAnnotation): AnnotationRecord {
  return {
    key,
    type,
    color,
    comment,
    text,
    parentKey,
    pageLabel,
    sortIndex,
    tags,
    tagDetails,
    position,
    version,
    lock: null,
    templateMetadata: {
      dateAdded,
      dateModified: dateModified ?? null,
      authorName: authorName ?? null,
      isExternal: isExternal ?? null,
      tags: templateTags(tagDetails),
    },
  };
}

export {
  ANNOTATIONS,
  TEXT_FIELD_SPECS,
  DRAFT_FIELDS,
  fieldMaps,
  indexedID,
  proposedText,
  sameText,
  freshValueOf,
  proposedTags,
  templateTags,
  fromLocalApi,
};
export type {
  DraftFields,
  DraftField,
  HeldAnnotation,
  WriteAttempt,
  OutcomeWrite,
  ConfirmedWrite,
  AnnotationConfirmation,
  GroupWrite,
  GroupKind,
  GroupWrites,
  ProposedFields,
  PendingProposal,
  AnnotationMutation,
  DatabaseAnswer,
};
