// The ZoteroReads contract: one RpcGroup and the Schema codecs both sides share.
import { Predicate, Schema, SchemaGetter } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import type {
  Annotation,
  AnnotationSources,
  AnnotViewAttachment,
  Attachment,
  AttachmentWithParentKey,
  ChildNote,
  Creator,
  getItemDisplayRefByID,
  IndexedItem,
  IndexSignature,
  Item,
  ItemBaseFields,
  ItemTag,
  Library,
  LibraryCitekey,
  Note,
  NoteSource,
  TemplateCollection,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import type { ItemFields } from "@zotlit/zotero-types";

import type { ZoteroReadMode } from "@/services/settings/schema";

/** Compile-time assert: `T` must be `true`. */
type Expect<T extends true> = T;
/** Mutual assignability: the decoded type is the `@zotlit/db` type. */
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

/**
 * `Temporal.Instant` is not structured-cloneable; it crosses the wire as its
 * ISO string and arrives as an `Instant`.
 */
export const Instant = Schema.String.pipe(
  Schema.decodeTo(Schema.instanceOf(Temporal.Instant), {
    decode: SchemaGetter.transform((s: string) => Temporal.Instant.from(s)),
    encode: SchemaGetter.transform((i: Temporal.Instant) => i.toString()),
  }),
);

/**
 * A raw Zotero integer column typed as its known values. Decoding accepts any
 * number: Zotero can add a value after the mapping was written, and the
 * `@zotlit/db` name resolvers already answer `"unknown"` for it.
 */
function rawInt<T extends number>() {
  return Schema.declare((u: unknown): u is T => Predicate.isNumber(u));
}

/**
 * A JSON object whose shape the `@zotlit/db` layer owns (item fields, base
 * fields, annotation position). It crosses the wire as JSON, unchanged.
 */
function jsonObject<T extends object>() {
  return Schema.declare((u: unknown): u is T => Predicate.isObject(u));
}

// --- Errors ---------------------------------------------------------------

/** The database cannot answer: no connection opens, or the source is not a Zotero database. */
export class DbUnavailable extends Schema.TaggedError<DbUnavailable>()(
  "DbUnavailable",
  { message: Schema.String },
) {}

/** The Snapshot id names no open Snapshot: it ended, timed out, or never existed. */
export class SnapshotExpired extends Schema.TaggedError<SnapshotExpired>()(
  "SnapshotExpired",
  { snapshot: Schema.String },
) {}

/** The errors a read can fail with. */
export const ReadError = Schema.Union([DbUnavailable, SnapshotExpired]);

// --- Rows -----------------------------------------------------------------

export const LibrarySchema = Schema.Struct({
  libraryID: Schema.Number,
  type: Schema.Literals(["user", "group"]),
  version: Schema.Number,
  clientVersion: Schema.NullOr(Schema.Number),
  groupID: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String),
});
type _Library = Expect<Equals<typeof LibrarySchema.Type, Library>>;

const CreatorSchema = Schema.Struct({
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  creatorType: Schema.String,
  fieldMode: rawInt<Creator["fieldMode"]>(),
});
type _Creator = Expect<Equals<typeof CreatorSchema.Type, Creator>>;

export const ItemSchema = Schema.Struct({
  itemID: Schema.Number,
  libraryID: Schema.Number,
  key: Schema.String,
  indexedKey: Schema.String,
  dateAdded: Instant,
  dateModified: Instant,
  creators: Schema.mutable(Schema.Array(CreatorSchema)),
  primaryCreatorType: Schema.NullOr(Schema.String),
  customFields: Schema.ReadonlyMap(Schema.String, Schema.NullOr(Schema.String)),
  fields: jsonObject<ItemFields>(),
  baseFields: jsonObject<ItemBaseFields>(),
  venue: Schema.NullOr(Schema.String),
  groupID: Schema.NullOr(Schema.Number),
});
type _Item = Expect<Equals<typeof ItemSchema.Type, Item>>;

const IndexedCreatorSchema = Schema.Struct({
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  fieldMode: rawInt<Creator["fieldMode"]>(),
});

export const IndexedItemSchema = Schema.Struct({
  itemID: Schema.Number,
  libraryID: Schema.Number,
  key: Schema.String,
  indexedKey: Schema.String,
  dateModified: Instant,
  itemType: Schema.String,
  primaryCreator: Schema.NullOr(IndexedCreatorSchema),
  creators: Schema.Array(IndexedCreatorSchema),
  language: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  publicationTitle: Schema.NullOr(Schema.String),
  shortTitle: Schema.NullOr(Schema.String),
  court: Schema.NullOr(Schema.String),
  citationKey: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
});
type _IndexedItem = Expect<Equals<typeof IndexedItemSchema.Type, IndexedItem>>;

export const AttachmentSchema = Schema.Struct({
  itemID: Schema.Number,
  libraryID: Schema.Number,
  groupID: Schema.NullOr(Schema.Number),
  key: Schema.String,
  indexedKey: Schema.String,
  parentItemID: Schema.Number,
  path: Schema.NullOr(Schema.String),
  contentType: Schema.NullOr(Schema.String),
  linkMode: Schema.NullOr(rawInt<NonNullable<Attachment["linkMode"]>>()),
  dateAdded: Instant,
  dateModified: Instant,
});
type _Attachment = Expect<Equals<typeof AttachmentSchema.Type, Attachment>>;

export const AttachmentWithParentKeySchema = Schema.Struct({
  ...AttachmentSchema.fields,
  parentIndexedKey: Schema.NullOr(Schema.String),
});
type _AttachmentWithParentKey = Expect<
  Equals<typeof AttachmentWithParentKeySchema.Type, AttachmentWithParentKey>
>;

type TagType = ItemTag["type"];

export const AnnotationSchema = Schema.Struct({
  groupID: Schema.NullOr(Schema.Number),
  itemID: Schema.Number,
  key: Schema.String,
  indexedKey: Schema.String,
  libraryID: Schema.Number,
  dateAdded: Instant,
  dateModified: Instant,
  version: Schema.Number,
  type: rawInt<Annotation["type"]>(),
  text: Schema.NullOr(Schema.String),
  comment: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  pageLabel: Schema.NullOr(Schema.String),
  tags: Schema.mutable(Schema.Array(Schema.String)),
  tagDetails: Schema.optionalKey(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({ name: Schema.String, type: rawInt<TagType>() }),
      ),
    ),
  ),
  sortIndex: Schema.String,
  position: jsonObject<AnnotationPositionRaw>(),
  authorName: Schema.NullOr(Schema.String),
  isExternal: Schema.Boolean,
  createdByUserID: Schema.NullOr(Schema.Number),
  parentItemID: Schema.Number,
  parentKey: Schema.String,
});
type _Annotation = Expect<Equals<typeof AnnotationSchema.Type, Annotation>>;

export const ChildNoteSchema = Schema.Struct({
  groupID: Schema.NullOr(Schema.Number),
  itemID: Schema.Number,
  libraryID: Schema.Number,
  key: Schema.String,
  indexedKey: Schema.String,
  parentItemID: Schema.NullOr(Schema.Number),
  title: Schema.NullOr(Schema.String),
  dateModified: Instant,
});
type _ChildNote = Expect<Equals<typeof ChildNoteSchema.Type, ChildNote>>;

export const NoteSchema = Schema.Struct({
  ...ChildNoteSchema.fields,
  note: Schema.NullOr(Schema.String),
  dateAdded: Instant,
});
type _Note = Expect<Equals<typeof NoteSchema.Type, Note>>;

const ItemTagSchema = Schema.Struct({
  itemID: Schema.Number,
  tag: Schema.Struct({ tagID: Schema.Number, name: Schema.String }),
  type: rawInt<TagType>(),
});
type _ItemTag = Expect<Equals<typeof ItemTagSchema.Type, ItemTag>>;

const TemplateCollectionSchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.Array(Schema.String),
});
type _TemplateCollection = Expect<
  Equals<typeof TemplateCollectionSchema.Type, TemplateCollection>
>;

const TagsByItemID = Schema.ReadonlyMap(
  Schema.Number,
  Schema.Array(ItemTagSchema),
);

export const NoteSourceSchema = Schema.Struct({
  item: ItemSchema,
  username: Schema.NullOr(Schema.String),
  attachments: Schema.Array(AttachmentSchema),
  annotationsByAttachment: Schema.ReadonlyMap(
    Schema.Number,
    Schema.Array(AnnotationSchema),
  ),
  tagsByItemID: TagsByItemID,
  collectionsByItemID: Schema.ReadonlyMap(
    Schema.Number,
    Schema.Array(TemplateCollectionSchema),
  ),
  relatedItems: Schema.Array(ItemSchema),
  childNotes: Schema.Array(ChildNoteSchema),
});
type _NoteSource = Expect<Equals<typeof NoteSourceSchema.Type, NoteSource>>;

export const AnnotationSourcesSchema = Schema.Struct({
  annotations: Schema.Array(AnnotationSchema),
  attachments: Schema.Array(AttachmentSchema),
  parentItems: Schema.Array(ItemSchema),
  tagsByItemID: TagsByItemID,
  username: Schema.NullOr(Schema.String),
});
type _AnnotationSources = Expect<
  Equals<typeof AnnotationSourcesSchema.Type, AnnotationSources>
>;

export const LibraryCitekeySchema = Schema.Struct({
  itemID: Schema.Number,
  libraryID: Schema.Number,
  key: Schema.String,
  indexedKey: Schema.String,
  citekey: Schema.String,
});
type _LibraryCitekey = Expect<
  Equals<typeof LibraryCitekeySchema.Type, LibraryCitekey>
>;

export const ItemDisplayRefSchema = Schema.Struct({
  itemID: Schema.Number,
  libraryID: Schema.Number,
  key: Schema.String,
  groupID: Schema.NullOr(Schema.Number),
  indexedKey: Schema.String,
  title: Schema.NullOr(Schema.String),
});
type _ItemDisplayRef = Expect<
  Equals<
    typeof ItemDisplayRefSchema.Type,
    NonNullable<ReturnType<typeof getItemDisplayRefByID>>
  >
>;

/** The inputs of one graph Work Label; the renderer formats the label. */
export const WorkLabelSourceSchema = Schema.Struct({
  libraryID: Schema.Number,
  creators: Schema.mutable(Schema.Array(CreatorSchema)),
  primaryCreatorType: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  shortTitle: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
});
export type WorkLabelSource = typeof WorkLabelSourceSchema.Type;

/** One attachment the annotation sidebar lists, with its annotation count. */
export const AnnotViewAttachmentSchema = Schema.Struct({
  itemID: Schema.Number,
  indexedKey: Schema.String,
  path: Schema.NullOr(Schema.String),
  annotCount: Schema.Number,
});
type _AnnotViewAttachment = Expect<
  Equals<typeof AnnotViewAttachmentSchema.Type, AnnotViewAttachment>
>;

/** What one Zotero reader push names, in Indexed Keys. */
export const ReaderTargetKeysSchema = Schema.Struct({
  attachmentKey: Schema.String,
  /** The parent Item; `null` for a standalone attachment. */
  itemKey: Schema.NullOr(Schema.String),
  /** The selected annotations that are live children of the attachment. */
  selected: Schema.Array(Schema.String),
});

/** A library's change-detection signature for the item index. */
export const IndexSignatureSchema = Schema.Struct({
  count: Schema.Number,
  checksum: Schema.Number,
});
type _IndexSignature = Expect<
  Equals<typeof IndexSignatureSchema.Type, IndexSignature>
>;

/** The account and Local API database a Zotero database belongs to. */
export const DatabaseIdentitySchema = Schema.Struct({
  userID: Schema.NullOr(Schema.Number),
  localUserKey: Schema.NullOr(Schema.String),
  serverID: Schema.NullOr(Schema.String),
});
type _DatabaseIdentity = Expect<
  Equals<typeof DatabaseIdentitySchema.Type, ZoteroDatabaseIdentity>
>;

/** The Item an Item Snapshot exports, and the context it carries. */
export const ItemSnapshotRequestSchema = Schema.Struct({
  selection: Schema.Struct({
    library: Schema.Union([
      Schema.Struct({ type: Schema.Literal("personal") }),
      Schema.Struct({ type: Schema.Literal("group"), groupID: Schema.Number }),
    ]),
    key: Schema.String,
  }),
  provenance: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("sample"),
      id: Schema.String,
      source: Schema.optionalKey(Schema.String),
    }),
    Schema.Struct({
      kind: Schema.Literal("connected"),
      installationId: Schema.String,
      vault: Schema.String,
    }),
  ]),
  vaultTargets: Schema.optionalKey(
    Schema.Struct({
      notes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      attachments: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String),
      ),
      annotationImages: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String),
      ),
    }),
  ),
});

// --- Lifecycle ------------------------------------------------------------

/** Settings that drive the source; `Configure` pushes them. */
export const ReadsConfigSchema = Schema.Struct({
  databasePath: Schema.String,
  readMode: Schema.Literals(["auto", "reflink", "copy", "immutable"]),
  autoRefresh: Schema.Boolean,
});
export type ReadsConfig = typeof ReadsConfigSchema.Type;
type _ReadMode = Expect<Equals<ReadsConfig["readMode"], ZoteroReadMode>>;

/** One event on the `Changes` stream. The first event is always `state`. */
export const ChangeEventSchema = Schema.Union([
  /** The state when the subscription starts. */
  Schema.TaggedStruct("state", {
    state: Schema.Literals(["loading", "ready", "degraded"]),
    error: Schema.NullOr(DbUnavailable),
  }),
  /** A new client serves; re-query cached results. */
  Schema.TaggedStruct("changed", {}),
  /** No client can serve. */
  Schema.TaggedStruct("degraded", { error: DbUnavailable }),
  /** A refresh failed; the previous client keeps serving. */
  Schema.TaggedStruct("refresh-failed", { error: DbUnavailable }),
  Schema.TaggedStruct("refreshing", { active: Schema.Boolean }),
  /** The configured database file is absent. */
  Schema.TaggedStruct("db-file-missing", {}),
]);
export type ChangeEvent = typeof ChangeEventSchema.Type;

// --- Operations -----------------------------------------------------------

/**
 * Pins one connection: an operation that names this id reads that connection
 * instead of the current one.
 */
export const SnapshotId = Schema.String;

/** The optional Snapshot every read accepts. */
const snapshot = { snapshot: Schema.optionalKey(SnapshotId) };

/** Items per stream slice; one slice is one emission and one cancel point. */
const sliceSize = { sliceSize: Schema.optionalKey(Schema.Number) };

export class ZoteroReads extends RpcGroup.make(
  Rpc.make("Libraries", {
    payload: snapshot,
    success: Schema.mutable(Schema.Array(LibrarySchema)),
    error: ReadError,
  }),
  /** Items across every library, independent of Library Scope. */
  Rpc.make("ConnectionReadout", {
    payload: snapshot,
    success: Schema.Struct({ itemCount: Schema.Number }),
    error: ReadError,
  }),
  Rpc.make("IndexItems", {
    payload: { libraryID: Schema.Number, ...sliceSize, ...snapshot },
    success: Schema.Array(IndexedItemSchema),
    error: ReadError,
    stream: true,
  }),
  /** Items keyed by Indexed Key; a key with no live item is absent. */
  Rpc.make("ItemsByIndexedKeys", {
    payload: { indexedKeys: Schema.Array(Schema.String), ...snapshot },
    success: Schema.ReadonlyMap(Schema.String, ItemSchema),
    error: ReadError,
  }),
  /** An item's related items and child notes; empty for an unknown item. */
  Rpc.make("ItemFamily", {
    payload: { itemID: Schema.Number, ...snapshot },
    success: Schema.Struct({
      relatedItems: Schema.Array(ItemSchema),
      childNotes: Schema.Array(ChildNoteSchema),
    }),
    error: ReadError,
  }),
  /** The Literature Note bundle for an item; `null` for an unknown item. */
  Rpc.make("NoteSource", {
    payload: {
      itemID: Schema.Number,
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: Schema.NullOr(NoteSourceSchema),
    error: ReadError,
  }),
  /** The annotation template bundle for annotations named by key. */
  Rpc.make("AnnotationSources", {
    payload: {
      libraryID: Schema.Number,
      keys: Schema.Array(Schema.String),
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: AnnotationSourcesSchema,
    error: ReadError,
  }),
  /** An attachment's annotations with the account facts their locks need. */
  Rpc.make("AnnotationsOfAttachment", {
    payload: { attachmentKey: Schema.String, ...snapshot },
    success: Schema.Struct({
      attachment: Schema.NullOr(AttachmentSchema),
      annotations: Schema.Array(AnnotationSchema),
      accountUserID: Schema.NullOr(Schema.Number),
    }),
    error: ReadError,
  }),
  /** The attachments of the given parent items, in display order. */
  Rpc.make("AttachmentsOf", {
    payload: { itemIDs: Schema.Array(Schema.Number), ...snapshot },
    success: Schema.Array(AttachmentSchema),
    error: ReadError,
  }),
  /** One entry per requested id; `ref` is `null` for an id with no live item. */
  Rpc.make("DisplayRefs", {
    payload: {
      itemIDs: Schema.Array(Schema.Number),
      ...sliceSize,
      ...snapshot,
    },
    success: Schema.Array(
      Schema.Struct({
        itemID: Schema.Number,
        ref: Schema.NullOr(ItemDisplayRefSchema),
      }),
    ),
    error: ReadError,
    stream: true,
  }),
  /** Notes with their bodies; a key with no live note is absent. */
  Rpc.make("NoteBodies", {
    payload: {
      libraryID: Schema.Number,
      keys: Schema.Array(Schema.String),
      ...snapshot,
    },
    success: Schema.Array(NoteSchema),
    error: ReadError,
  }),
  /** Work Label inputs keyed by Indexed Key; child items and unknown keys are absent. */
  Rpc.make("WorkLabels", {
    payload: { indexedKeys: Schema.Array(Schema.String), ...snapshot },
    success: Schema.ReadonlyMap(Schema.String, WorkLabelSourceSchema),
    error: ReadError,
  }),
  Rpc.make("AttachmentPathIndex", {
    payload: { ...sliceSize, ...snapshot },
    success: Schema.Array(AttachmentWithParentKeySchema),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("CitekeySnapshot", {
    payload: { libraryID: Schema.Number, ...snapshot },
    success: Schema.Array(LibraryCitekeySchema),
    error: ReadError,
  }),
  Rpc.make("Changes", {
    success: ChangeEventSchema,
    stream: true,
  }),
  /**
   * Emits one Snapshot id and holds its connection until the caller ends the
   * stream, or until no read names it for the idle timeout.
   */
  Rpc.make("Snapshot", {
    success: SnapshotId,
    error: DbUnavailable,
    stream: true,
  }),
  Rpc.make("Refresh", { error: DbUnavailable }),
  Rpc.make("NotifyExternalChange", {}),
  Rpc.make("Configure", { payload: ReadsConfigSchema }),
  /** The item index signature of one library; an unknown library counts zero. */
  Rpc.make("IndexSignature", {
    payload: { libraryID: Schema.Number, ...snapshot },
    success: IndexSignatureSchema,
    error: ReadError,
  }),
  /** Attachments of one library by key; a key with no live attachment is absent. */
  Rpc.make("AttachmentsByKeys", {
    payload: {
      libraryID: Schema.Number,
      keys: Schema.Array(Schema.String),
      ...snapshot,
    },
    success: Schema.Array(AttachmentSchema),
    error: ReadError,
  }),
  /** The identity excerpt assets are keyed by. */
  Rpc.make("DatabaseIdentity", {
    payload: snapshot,
    success: DatabaseIdentitySchema,
    error: ReadError,
  }),
  /**
   * The Item Snapshot the Local Server and the note preview serve. An Item
   * outside the selected Library fails with {@link DbUnavailable}.
   */
  Rpc.make("ItemSnapshot", {
    payload: { ...ItemSnapshotRequestSchema.fields, ...snapshot },
    success: jsonObject<ItemSnapshot>(),
    error: ReadError,
  }),
  /** The library, key, and type of any live Item, child Items included; `null` for none. */
  Rpc.make("ItemType", {
    payload: { indexedKey: Schema.String, ...snapshot },
    success: Schema.NullOr(
      Schema.Struct({
        libraryID: Schema.Number,
        key: Schema.String,
        itemType: Schema.String,
      }),
    ),
    error: ReadError,
  }),
  /**
   * The attachments the annotation sidebar lists: an item's attachments, or
   * a standalone attachment alone. Empty for an unknown key.
   */
  Rpc.make("AnnotViewAttachments", {
    payload: {
      libraryID: Schema.Number,
      key: Schema.String,
      standalone: Schema.Boolean,
      ...snapshot,
    },
    success: Schema.mutable(Schema.Array(AnnotViewAttachmentSchema)),
    error: ReadError,
  }),
  /** A Zotero reader push's numeric ids as Indexed Keys; `null` for an unknown attachment. */
  Rpc.make("ReaderTargetKeys", {
    payload: {
      attachmentID: Schema.Number,
      selected: Schema.Array(Schema.Number),
      ...snapshot,
    },
    success: Schema.NullOr(ReaderTargetKeysSchema),
    error: ReadError,
  }),
  /**
   * Attachments by Indexed Key, with their parent items, the parents' tags,
   * and the username: an Annotation's parent context without its own row. A
   * key with no live attachment is absent.
   */
  Rpc.make("AttachmentSources", {
    payload: {
      attachmentKeys: Schema.Array(Schema.String),
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: AnnotationSourcesSchema,
    error: ReadError,
  }),
) {}
