// The ZoteroReads handler layer: each operation composes @zotlit/db query functions over a borrowed Connection.
import { chunk } from "@std/collections/chunk";
import { Clock, Duration, Effect, Exit, Scope, Stream } from "effect";

import {
  CollectionCache,
  fetchAnnotationSources,
  fetchNoteSource,
  getAccountUserID,
  getAnnotationsByKey,
  getAnnotationsByParent,
  getAttachmentByKey,
  getAttachmentPage,
  getAttachmentsByParents,
  getChildNotesByParentIDs,
  getCitekeysByLibrary,
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
  getItemDisplayRefByID,
  getItemsByID,
  getItemsByKey,
  getLibraries,
  getNoteByKey,
  getRelatedKeysByItemID,
  isChildItemFields,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { GroupIDMemo, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { Connection, toDbUnavailable } from "./connection";
import { SnapshotExpired, ZoteroReads } from "./rpc";
import type { DbUnavailable } from "./rpc";
import type { WorkLabelSource } from "./rpc";

/** Items per stream slice: a cancel point about every 300 ms on a large library. */
export const DEFAULT_SLICE_SIZE = 500;

/** How long a Snapshot may go unused before the worker ends it. */
export const DEFAULT_SNAPSHOT_IDLE_TIMEOUT = Duration.minutes(5);

export interface HandlersOptions {
  /** @default {@link DEFAULT_SNAPSHOT_IDLE_TIMEOUT} */
  snapshotIdleTimeout?: Duration.Input;
}

/** Run a synchronous read; a SQLite throw becomes a {@link DbUnavailable}. */
function read<A>(
  client: NodeDatabaseClient,
  f: (client: NodeDatabaseClient) => A,
): Effect.Effect<A, DbUnavailable> {
  return Effect.try({ try: () => f(client), catch: toDbUnavailable });
}

/** Cut `inputs` into stream slices of `size` (default {@link DEFAULT_SLICE_SIZE}). */
function slicesOf<I>(inputs: readonly I[], size: number | undefined): I[][] {
  return chunk(inputs, size ?? DEFAULT_SLICE_SIZE);
}

/**
 * One slice per element: each slice is its own query and its own message, and
 * an interrupt lands between slices. The server reads ahead only as far as the
 * client's stream buffer, so other requests interleave with a long stream.
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

/** Live items for Indexed Keys, keyed by Indexed Key. */
function itemsByIndexedKeys(
  client: NodeDatabaseClient,
  indexedKeys: readonly string[],
): Map<string, Item> {
  const keysByLibrary = new Map<number, string[]>();
  for (const indexedKey of indexedKeys) {
    const selector = resolveIndexedKeyLibrary(client, indexedKey);
    if (!selector) continue;
    const keys = keysByLibrary.get(selector.libraryID) ?? [];
    keys.push(selector.key);
    keysByLibrary.set(selector.libraryID, keys);
  }
  const items = new Map<string, Item>();
  for (const [libraryID, keys] of keysByLibrary) {
    for (const item of getItemsByKey(client, libraryID, keys)) {
      items.set(item.indexedKey, item);
    }
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

/** A connection a Snapshot pinned, with the reads using it right now. */
interface Pinned {
  readonly client: NodeDatabaseClient;
  /** Holds the borrow; closes after the Snapshot ends and its last read finishes. */
  readonly scope: Scope.Closeable;
  active: number;
  ended: boolean;
  /** Clock time when a read last named this Snapshot, or when it opened. */
  lastUsed: number;
}

export function handlersLayer(options?: HandlersOptions) {
  const idleTimeout = options?.snapshotIdleTimeout
    ? Duration.fromInputUnsafe(options.snapshotIdleTimeout)
    : DEFAULT_SNAPSHOT_IDLE_TIMEOUT;

  return ZoteroReads.toLayer(
    Effect.gen(function* () {
      const connection = yield* Connection;
      const pinned = new Map<string, Pinned>();
      let snapshots = 0;

      const releasePinned = (entry: Pinned) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          entry.active -= 1;
          entry.lastUsed = now;
          return entry.ended && entry.active === 0
            ? Scope.close(entry.scope, Exit.void)
            : Effect.void;
        });

      /**
       * Borrow for the caller's scope: the Snapshot's pinned connection when
       * one is named, the current connection otherwise.
       */
      const borrow = (
        snapshot: string | undefined,
      ): Effect.Effect<
        NodeDatabaseClient,
        DbUnavailable | SnapshotExpired,
        Scope.Scope
      > => {
        if (snapshot === undefined) return connection.borrow;
        return Effect.acquireRelease(
          Effect.flatMap(Clock.currentTimeMillis, (now) => {
            const entry = pinned.get(snapshot);
            if (!entry) return Effect.fail(new SnapshotExpired({ snapshot }));
            entry.active += 1;
            entry.lastUsed = now;
            return Effect.succeed(entry);
          }),
          releasePinned,
        ).pipe(Effect.map((entry) => entry.client));
      };

      /** Borrow for one request and run `f` on the client. */
      const withClient = <A>(
        snapshot: string | undefined,
        f: (client: NodeDatabaseClient) => A,
      ) =>
        Effect.scoped(
          Effect.flatMap(borrow(snapshot), (client) => read(client, f)),
        );

      /** Borrow for a stream's whole life and build the stream on the client. */
      const withClientStream = <A>(
        snapshot: string | undefined,
        f: (client: NodeDatabaseClient) => Stream.Stream<A, DbUnavailable>,
      ) => Stream.unwrap(Effect.map(borrow(snapshot), f));

      /** Ends once no read has named `entry` for one idle timeout. */
      const idle = (entry: Pinned) =>
        Effect.gen(function* () {
          const timeout = Duration.toMillis(idleTimeout);
          for (;;) {
            const now = yield* Clock.currentTimeMillis;
            const due = entry.lastUsed + timeout;
            if (entry.active === 0 && now >= due) return;
            yield* Effect.sleep(entry.active > 0 ? timeout : due - now);
          }
        });

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

        IndexItems: ({ libraryID, sliceSize, snapshot }) =>
          withClientStream(snapshot, (client) =>
            Stream.unwrap(
              Effect.map(
                read(client, (c) => getIndexedItemIDsByLibrary(c, libraryID)),
                (ids) =>
                  sliced(client, slicesOf(ids, sliceSize), getIndexedItemsByID),
              ),
            ),
          ),

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
            const item = getItemsByID(client, [payload.itemID])[0];
            if (!item) return null;
            return fetchNoteSource(client, item, {
              ...("username" in payload && { username: payload.username }),
              collectionCache: new CollectionCache(),
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

        DisplayRefs: ({ itemIDs, sliceSize, snapshot }) =>
          withClientStream(snapshot, (client) => {
            const memo: GroupIDMemo = new Map();
            return sliced(client, slicesOf(itemIDs, sliceSize), (c, ids) =>
              ids.map((itemID) => ({
                itemID,
                ref: getItemDisplayRefByID(c, itemID, { memo }),
              })),
            );
          }),

        NoteBodies: ({ libraryID, keys, snapshot }) =>
          withClient(snapshot, (client) => {
            const memo: GroupIDMemo = new Map();
            return keys.flatMap(
              (key) => getNoteByKey(client, key, { libraryID, memo }) ?? [],
            );
          }),

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
        AttachmentPathIndex: ({ sliceSize, snapshot }) =>
          withClientStream(snapshot, (client) => {
            const limit = sliceSize ?? DEFAULT_SLICE_SIZE;
            const memo: GroupIDMemo = new Map();
            return Stream.unfold(0, (afterItemID) =>
              Effect.map(
                read(client, (c) =>
                  getAttachmentPage(c, { afterItemID, limit }, { memo }),
                ),
                (page) =>
                  page.length === 0
                    ? undefined
                    : ([page, page.at(-1)!.itemID] as const),
              ),
            );
          }),

        CitekeySnapshot: ({ libraryID, snapshot }) =>
          withClient(snapshot, (client) =>
            getCitekeysByLibrary(client, libraryID),
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
                const id = `snapshot-${++snapshots}`;
                const entry: Pinned = {
                  client,
                  scope,
                  active: 0,
                  ended: false,
                  lastUsed: yield* Clock.currentTimeMillis,
                };
                pinned.set(id, entry);
                // The stream's scope ends when the caller ends the stream or
                // the idle check runs out; the pinned borrow ends after the
                // Snapshot's last read.
                yield* Effect.addFinalizer(() =>
                  Effect.suspend(() => {
                    pinned.delete(id);
                    entry.ended = true;
                    return entry.active === 0
                      ? Scope.close(scope, Exit.void)
                      : Effect.void;
                  }),
                );
                return Stream.concat(
                  Stream.make(id),
                  Stream.drain(Stream.fromEffect(idle(entry))),
                );
              }),
            ),
          ),

        Refresh: () => connection.refresh,
        NotifyExternalChange: () => connection.notifyExternalChange,
        Configure: (config) => connection.configure(config),
      });
    }),
  );
}
