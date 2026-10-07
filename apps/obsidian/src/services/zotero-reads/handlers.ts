// The ZoteroReads handler layer: each operation composes @zotlit/db query functions over a borrowed Connection.
import { chunk } from "@std/collections/chunk";
import { Effect, Exit, Scope, Stream } from "effect";

import {
  CollectionCache,
  fetchAnnotationSources,
  fetchAttachmentSources,
  fetchNoteSource,
  getAccountUserID,
  getAnnotationsByKey,
  getAnnotationsByParent,
  getAnnotViewAttachments,
  getAttachmentAnnotationCount,
  getAttachmentByItemId,
  getAttachmentByKey,
  getAttachmentPage,
  getAttachmentsByParents,
  getChildNotesByParentIDs,
  getAllTagNames,
  getCitekeyPage,
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
  getItemDisplayRefsByIDs,
  getItemRefByID,
  getItemsByID,
  getItemsByKey,
  getItemTypeByKey,
  getLibraries,
  getLibraryTagNames,
  getNotesByKey,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
  getNoteRefsByItemIDs,
  getRelatedKeysByItemID,
  getZoteroIdentity,
  getZoteroDatabaseIdentity,
  isChildItemFields,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { GroupIDMemo, Item, TagMemo } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";

import { Connection, toDbUnavailable } from "./connection";
import { listCollectionChoices, resolveMembershipFacts } from "./membership";
import { SnapshotExpired, SnapshotId, ZoteroReads } from "./rpc";
import type { DbUnavailable } from "./rpc";
import type { WorkLabelSource } from "./rpc";

/** The id queries {@link ZoteroReads} `ScopeItemIDs` runs, per kind. */
const SCOPE_QUERIES = {
  "literature-items": {
    byLibrary: getIndexedItemIDsByLibrary,
    byCollection: getIndexedItemIDsByCollection,
  },
  notes: {
    byLibrary: getNoteItemIDsByLibrary,
    byCollection: getNoteItemIDsByCollection,
  },
} as const;

/** Items per stream slice: a cancel point about every 300 ms on a large library. */
export const DEFAULT_SLICE_SIZE = 500;

export interface HandlersOptions {
  /**
   * Items per stream slice; one slice is one emission and one cancel point.
   * Tests shrink it to see several slices from a small fixture.
   *
   * @default {@link DEFAULT_SLICE_SIZE}
   */
  sliceSize?: number;
}

/** Run a synchronous read; a SQLite throw becomes a {@link DbUnavailable}. */
function read<A>(
  client: NodeDatabaseClient,
  f: (client: NodeDatabaseClient) => A,
): Effect.Effect<A, DbUnavailable> {
  return Effect.try({ try: () => f(client), catch: toDbUnavailable });
}

/**
 * One slice per element: each slice is its own query and its own message, and
 * an interrupt lands between slices. The server reads the next slice only once
 * the client acknowledged the last, so other requests interleave with a long
 * stream.
 */
function sliced<I, O>(
  client: NodeDatabaseClient,
  slices: readonly I[][],
  query: (client: NodeDatabaseClient, slice: I[]) => O,
): Stream.Stream<O, DbUnavailable> {
  return Stream.fromIterable(slices, { chunkSize: 1 }).pipe(
    Stream.mapEffect((slice) => read(client, (c) => query(c, slice))),
  );
}

/**
 * Live items for Indexed Keys, keyed by Indexed Key in request order. Each
 * Library the keys span resolves once and reads its items in one batched
 * statement, whatever the number of keys.
 */
function itemsByIndexedKeys(
  client: NodeDatabaseClient,
  indexedKeys: readonly string[],
): Map<string, Item> {
  // Each requested spelling (`g7` or `g007`) with the Library and item key it resolves to.
  const libraryByGroupID = new Map<number | null, number | null>();
  const requested: { indexedKey: string; libraryID: number; key: string }[] =
    [];
  const keysByLibrary = new Map<number, string[]>();
  for (const indexedKey of indexedKeys) {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) continue;
    if (!libraryByGroupID.has(parsed.groupID)) {
      libraryByGroupID.set(
        parsed.groupID,
        resolveIndexedKeyLibrary(client, indexedKey)?.libraryID ?? null,
      );
    }
    const libraryID = libraryByGroupID.get(parsed.groupID);
    if (libraryID == null) continue;
    requested.push({ indexedKey, libraryID, key: parsed.key });
    keysByLibrary.set(libraryID, [
      ...(keysByLibrary.get(libraryID) ?? []),
      parsed.key,
    ]);
  }
  const found = new Map<number, Map<string, Item>>();
  for (const [libraryID, keys] of keysByLibrary) {
    found.set(
      libraryID,
      new Map(
        getItemsByKey(client, libraryID, keys).map((item) => [item.key, item]),
      ),
    );
  }
  const items = new Map<string, Item>();
  for (const { indexedKey, libraryID, key } of requested) {
    const item = found.get(libraryID)?.get(key);
    if (item) items.set(indexedKey, item);
  }
  return items;
}

function workLabelSource(
  item: Item,
  fields: {
    readonly title?: string | null;
    readonly shortTitle?: string | null;
    readonly date?: string | null;
  },
): WorkLabelSource {
  return {
    libraryID: item.libraryID,
    creators: item.creators,
    primaryCreatorType: item.primaryCreatorType,
    title: fields.title ?? null,
    shortTitle: fields.shortTitle ?? null,
    date: fields.date ?? null,
  };
}

/** Lookup memos that stay valid for one database state. */
interface NoteMemos {
  readonly collectionCache: CollectionCache;
  readonly tagMemo: TagMemo;
  readonly groupIdMemo: GroupIDMemo;
  /** The signed-in account username; `undefined` until first read. */
  username?: string | null;
}

function noteMemos(): NoteMemos {
  return {
    collectionCache: new CollectionCache(),
    tagMemo: new Map(),
    groupIdMemo: new Map(),
  };
}

/** A connection a Snapshot pinned, with the reads using it right now. */
interface Pinned {
  readonly client: NodeDatabaseClient;
  /** Shared by the Snapshot's reads: a batch resolves each tag and collection once. */
  readonly memos: NoteMemos;
  /** Holds the borrow; closes after the Snapshot ends and its last read finishes. */
  readonly scope: Scope.Closeable;
  active: number;
  ended: boolean;
}

export function handlersLayer(options?: HandlersOptions) {
  const sliceSize = options?.sliceSize ?? DEFAULT_SLICE_SIZE;
  /** Cut `inputs` into stream slices. */
  const slicesOf = <I>(inputs: readonly I[]): I[][] => chunk(inputs, sliceSize);

  /**
   * One entry per requested id, in request order, sliced. `lookup` reads a
   * whole slice through batched `@zotlit/db` queries (one statement each, never
   * one per id); `entry` builds each id's entry from that result without the
   * database. The stream's lookups share one group-id memo.
   */
  const idEntries = <L, E>(
    client: NodeDatabaseClient,
    itemIDs: readonly number[],
    {
      lookup,
      entry,
    }: {
      lookup: (
        client: NodeDatabaseClient,
        ids: readonly number[],
        opts: { memo: GroupIDMemo },
      ) => L;
      entry: (itemID: number, found: L) => E;
    },
  ): Stream.Stream<E[], DbUnavailable> => {
    const memo: GroupIDMemo = new Map();
    return sliced(client, slicesOf(itemIDs), (c, ids) => {
      const found = lookup(c, ids, { memo });
      return ids.map((itemID) => entry(itemID, found));
    });
  };

  return ZoteroReads.toLayer(
    Effect.gen(function* () {
      const connection = yield* Connection;
      const pinned = new Map<SnapshotId, Pinned>();
      let snapshots = 0;

      const releasePinned = (entry: Pinned) =>
        Effect.suspend(() => {
          entry.active -= 1;
          return entry.ended && entry.active === 0
            ? Scope.close(entry.scope, Exit.void)
            : Effect.void;
        });

      /**
       * Borrow for the caller's scope: the Snapshot's pinned connection when
       * one is named, the current connection otherwise.
       */
      const borrow = (
        snapshot: SnapshotId | undefined,
      ): Effect.Effect<
        NodeDatabaseClient,
        DbUnavailable | SnapshotExpired,
        Scope.Scope
      > => {
        if (snapshot === undefined) return connection.borrow;
        return Effect.acquireRelease(
          Effect.suspend(() => {
            const entry = pinned.get(snapshot);
            if (!entry) return Effect.fail(new SnapshotExpired({ snapshot }));
            entry.active += 1;
            return Effect.succeed(entry);
          }),
          releasePinned,
        ).pipe(Effect.map((entry) => entry.client));
      };

      /** Borrow for one request and run `f` on the client. */
      const withClient = <A>(
        snapshot: SnapshotId | undefined,
        f: (client: NodeDatabaseClient) => A,
      ) =>
        Effect.scoped(
          Effect.flatMap(borrow(snapshot), (client) => read(client, f)),
        );

      /** Borrow for a stream's whole life and build the stream on the client. */
      const withClientStream = <A>(
        snapshot: SnapshotId | undefined,
        f: (client: NodeDatabaseClient) => Stream.Stream<A, DbUnavailable>,
      ) => Stream.unwrap(Effect.map(borrow(snapshot), f));

      return ZoteroReads.of({
        Libraries: ({ snapshot }) => withClient(snapshot, getLibraries),

        ConnectionReadout: ({ snapshot }) =>
          withClient(snapshot, (client) => ({
            itemCount: getLibraries(client).reduce(
              (total, library) =>
                total + getIndexSignature(client, library.libraryID).count,
              0,
            ),
          })),

        IndexItems: ({ libraryID, snapshot }) =>
          withClientStream(snapshot, (client) => {
            const memo: GroupIDMemo = new Map();
            return Stream.unwrap(
              Effect.map(
                read(client, (c) => getIndexedItemIDsByLibrary(c, libraryID)),
                (ids) =>
                  sliced(client, slicesOf(ids), (c, slice) =>
                    getIndexedItemsByID(c, slice, { memo }),
                  ),
              ),
            );
          }),

        ItemsByIndexedKeys: ({ indexedKeys, snapshot }) =>
          withClient(snapshot, (client) =>
            itemsByIndexedKeys(client, indexedKeys),
          ),

        ItemFamily: ({ itemID, snapshot }) =>
          withClient(snapshot, (client) => {
            const item = getItemsByID(client, [itemID])[0];
            if (!item) return { relatedItems: [], childNotes: [] };
            return {
              relatedItems: getItemsByKey(
                client,
                item.libraryID,
                getRelatedKeysByItemID(client, itemID),
              ),
              childNotes: getChildNotesByParentIDs(client, [itemID]),
            };
          }),

        NoteSource: (payload) =>
          withClient(payload.snapshot, (client) => {
            const memos =
              (payload.snapshot !== undefined &&
                pinned.get(payload.snapshot)?.memos) ||
              noteMemos();
            const item = getItemsByID(client, [payload.itemID], {
              memo: memos.groupIdMemo,
            })[0];
            if (!item) return null;
            // A batch under one Snapshot reads the account once.
            if (!("username" in payload) && memos.username === undefined)
              memos.username = getZoteroIdentity(client).username;
            return fetchNoteSource(client, item, {
              collectionCache: memos.collectionCache,
              tagMemo: memos.tagMemo,
              groupIdMemo: memos.groupIdMemo,
              username:
                "username" in payload
                  ? (payload.username ?? null)
                  : (memos.username ?? null),
            });
          }),

        AnnotationSources: (payload) =>
          withClient(payload.snapshot, (client) =>
            fetchAnnotationSources(
              client,
              getAnnotationsByKey(client, payload.keys, payload.libraryID),
              { ...("username" in payload && { username: payload.username }) },
            ),
          ),

        AnnotationsOfAttachment: ({ attachmentKey, snapshot }) =>
          withClient(snapshot, (client) => {
            const library = resolveIndexedKeyLibrary(client, attachmentKey);
            const attachment = library
              ? getAttachmentByKey(client, library.key, library.libraryID)
              : null;
            return {
              attachment,
              annotations: attachment
                ? getAnnotationsByParent(client, attachment.itemID)
                : [],
              accountUserID: getAccountUserID(client),
            };
          }),

        AttachmentsOf: ({ itemIDs, snapshot }) =>
          withClient(snapshot, (client) =>
            getAttachmentsByParents(client, itemIDs),
          ),

        DisplayRefs: ({ itemIDs, snapshot }) =>
          withClientStream(snapshot, (client) =>
            idEntries(client, itemIDs, {
              lookup: getItemDisplayRefsByIDs,
              entry: (itemID, refs) => ({
                itemID,
                ref: refs.get(itemID) ?? null,
              }),
            }),
          ),

        NoteBodies: ({ libraryID, keys, snapshot }) =>
          withClient(snapshot, (client) =>
            getNotesByKey(client, libraryID, keys),
          ),

        WorkLabels: ({ indexedKeys, snapshot }) =>
          withClient(snapshot, (client) => {
            const labels = new Map<string, WorkLabelSource>();
            for (const [indexedKey, item] of itemsByIndexedKeys(
              client,
              indexedKeys,
            )) {
              const fields = item.fields;
              if (isChildItemFields(fields)) continue;
              labels.set(indexedKey, workLabelSource(item, fields));
            }
            return labels;
          }),

        // Keyset pages in itemID order: one statement per slice.
        AttachmentPathIndex: ({ snapshot }) =>
          withClientStream(snapshot, (client) => {
            const memo: GroupIDMemo = new Map();
            return Stream.unfold(0, (afterItemID) =>
              Effect.map(
                read(client, (c) =>
                  getAttachmentPage(
                    c,
                    { afterItemID, limit: sliceSize },
                    { memo },
                  ),
                ),
                (page) =>
                  page.length === 0
                    ? undefined
                    : ([page, page.at(-1)!.itemID] as const),
              ),
            );
          }),

        // Keyset pages in itemID order: one statement per slice.
        CitekeySnapshot: ({ libraryID, snapshot }) =>
          withClientStream(snapshot, (client) =>
            Stream.unfold(0, (afterItemID) =>
              Effect.map(
                read(client, (c) =>
                  getCitekeyPage(c, {
                    libraryID,
                    afterItemID,
                    limit: sliceSize,
                  }),
                ),
                ({ citekeys, next }) =>
                  next === null ? undefined : ([citekeys, next] as const),
              ),
            ),
          ),

        Changes: () => connection.changes,

        Snapshot: () =>
          Stream.unwrap(
            // Uninterruptible from the borrow to the finalizer, so an
            // interrupt cannot strand the pinned borrow outside every scope.
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const scope = yield* Scope.make();
                const client = yield* restore(
                  Scope.provide(connection.borrow, scope),
                ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
                const id = SnapshotId.make(`snapshot-${++snapshots}`);
                const entry: Pinned = {
                  client,
                  memos: noteMemos(),
                  scope,
                  active: 0,
                  ended: false,
                };
                pinned.set(id, entry);
                // The Snapshot lives as long as its stream: the stream's scope
                // ends when the caller ends the stream or its client goes
                // away. The pinned borrow ends after the Snapshot's last read.
                yield* Effect.addFinalizer(() =>
                  Effect.suspend(() => {
                    pinned.delete(id);
                    entry.ended = true;
                    return entry.active === 0
                      ? Scope.close(scope, Exit.void)
                      : Effect.void;
                  }),
                );
                return Stream.concat(Stream.make(id), Stream.never);
              }),
            ),
          ),

        Refresh: () => connection.refresh,
        NotifyExternalChange: () => connection.notifyExternalChange,
        Configure: (config) => connection.configure(config),
        Ping: () => Effect.void,

        IndexSignature: ({ libraryID, snapshot }) =>
          withClient(snapshot, (client) =>
            getIndexSignature(client, libraryID),
          ),

        AttachmentsByKeys: ({ libraryID, keys, snapshot }) =>
          withClient(snapshot, (client) =>
            keys.flatMap(
              (key) => getAttachmentByKey(client, key, libraryID) ?? [],
            ),
          ),

        DatabaseIdentity: ({ snapshot }) =>
          withClient(snapshot, getZoteroDatabaseIdentity),

        ItemType: ({ indexedKey, snapshot }) =>
          withClient(snapshot, (client) => {
            const selector = resolveIndexedKeyLibrary(client, indexedKey);
            if (!selector) return null;
            const itemType = getItemTypeByKey(
              client,
              selector.libraryID,
              selector.key,
            );
            return itemType === null ? null : { ...selector, itemType };
          }),

        ItemSnapshot: ({ selection, provenance, vaultTargets, snapshot }) =>
          withClient(snapshot, (client) =>
            exportItemSnapshot(client, selection, {
              provenance,
              ...(vaultTargets && { vaultTargets }),
            }),
          ),
        AnnotViewAttachments: ({ libraryID, key, standalone, snapshot }) =>
          withClient(snapshot, (client) => {
            if (!standalone)
              return getAnnotViewAttachments(client, key, libraryID);
            const attachment = getAttachmentByKey(client, key, libraryID);
            return attachment
              ? [
                  {
                    itemID: attachment.itemID,
                    indexedKey: attachment.indexedKey,
                    path: attachment.path,
                    annotCount: getAttachmentAnnotationCount(
                      client,
                      attachment.itemID,
                    ),
                  },
                ]
              : [];
          }),

        // The numeric ids a push carries stop here.
        ReaderTargetKeys: ({ attachmentID, selected, snapshot }) =>
          withClient(snapshot, (client) => {
            const attachment = getAttachmentByItemId(client, attachmentID);
            if (!attachment) return null;
            return {
              attachmentKey: attachment.indexedKey,
              itemKey: attachment.parentItemID
                ? (getItemRefByID(client, attachment.parentItemID)
                    ?.indexedKey ?? null)
                : null,
              selected: getAnnotationsByParent(client, attachment.itemID)
                .filter((annotation) => selected.includes(annotation.itemID))
                .map((annotation) => annotation.indexedKey),
            };
          }),

        AttachmentsAt: ({ itemID, snapshot }) =>
          withClient(snapshot, (client) => {
            const attachment = getAttachmentByItemId(client, itemID);
            return attachment
              ? [attachment]
              : getAttachmentsByParents(client, [itemID]);
          }),

        AttachmentSources: (payload) =>
          withClient(payload.snapshot, (client) => {
            const attachments = payload.attachmentKeys.flatMap((indexedKey) => {
              const library = resolveIndexedKeyLibrary(client, indexedKey);
              const attachment =
                library &&
                getAttachmentByKey(client, library.key, library.libraryID);
              return attachment ? [attachment] : [];
            });
            return fetchAttachmentSources(client, attachments, {
              ...("username" in payload && { username: payload.username }),
            });
          }),

        ScopeItemIDs: ({ kind, libraryID, collectionKey, snapshot }) =>
          withClient(snapshot, (client) => {
            const queries = SCOPE_QUERIES[kind];
            if (collectionKey === undefined)
              return queries.byLibrary(client, libraryID);
            const collection = { libraryID, collectionKey };
            if (getCollectionIDByKey(client, collection) === undefined)
              return null;
            return queries.byCollection(client, collection);
          }),

        NoteRefs: ({ itemIDs, snapshot }) =>
          withClientStream(snapshot, (client) =>
            idEntries(client, itemIDs, {
              lookup: getNoteRefsByItemIDs,
              entry: (itemID, refs) => {
                const ref = refs.get(itemID);
                return {
                  itemID,
                  note: ref && !ref.trashed ? ref.note : null,
                  trashed: ref?.trashed ?? false,
                };
              },
            }),
          ),

        ChildNoteRefs: ({ itemIDs, snapshot }) =>
          withClientStream(snapshot, (client) =>
            idEntries(client, itemIDs, {
              lookup: (c, ids, opts) => ({
                refs: getItemDisplayRefsByIDs(c, ids, opts),
                notes: Map.groupBy(
                  getChildNotesByParentIDs(c, ids, opts),
                  (note) => note.parentItemID,
                ),
              }),
              entry: (itemID, { refs, notes }) => ({
                itemID,
                ref: refs.get(itemID) ?? null,
                notes: notes.get(itemID) ?? [],
              }),
            }),
          ),

        TagNames: ({ libraryID, snapshot }) =>
          withClient(snapshot, (client) =>
            libraryID === undefined
              ? getAllTagNames(client)
              : getLibraryTagNames(client, libraryID),
          ),

        CollectionPaths: ({ libraryIDs, snapshot }) =>
          withClient(snapshot, (client) =>
            listCollectionChoices(
              client,
              libraryIDs.map((libraryID) => ({ libraryID })),
            ).map(({ path }) => path),
          ),

        MembershipFacts: ({ itemID, libraryID, snapshot }) =>
          withClient(snapshot, (client) =>
            resolveMembershipFacts(client, { itemID, libraryID }),
          ),
      });
    }),
  );
}
