// The bridge reads that each part of the Annotation Repository core shares: the demanded Local API source, its state, and the query client.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import { Effect, Exit, Request, RequestResolver } from "effect";

import type { Held } from "@/services/query-client/service";
import type {
  LocalApiSource,
  LocalApiState,
} from "@/services/zotero-local-api/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import type { DatabaseAnswer } from "./model";
import type { CoreState } from "./state";

/** Why the Zotero database answered no rows: no Snapshot, or a failed read. */
type DatabaseRowsError =
  | Effect.Error<ZoteroReads["Service"]["snapshot"]>
  | Effect.Error<
      ReturnType<ZoteroReads["Service"]["reads"]["AnnotationsOfAttachments"]>
    >;

/** One Attachment's rows, asked in the batch of one database generation. */
class DatabaseRows extends Request.Class<
  { readonly attachmentKey: string; readonly generation: number },
  DatabaseAnswer,
  DatabaseRowsError
> {}

/**
 * The batch every database read asked in one task joins, by database
 * generation: one Snapshot and one query for all of them, whatever number of
 * Attachments a view shows. A read asked after a database change asks in the
 * new generation, so it reads the database that stands now.
 */
function databaseRowsResolver(
  db: Pick<ZoteroReads["Service"], "snapshot">,
): RequestResolver.RequestResolver<DatabaseRows> {
  return RequestResolver.makeGrouped<DatabaseRows, number>({
    key: ({ request }) => request.generation,
    resolver: (entries) =>
      Effect.gen(function* () {
        const attachmentKeys = [
          ...new Set(entries.map(({ request }) => request.attachmentKey)),
        ];
        const reads = yield* db.snapshot;
        const [found, libraries, database] = yield* Effect.all(
          [
            reads.AnnotationsOfAttachments({ attachmentKeys }),
            reads.Libraries({}),
            reads.DatabaseIdentity({}),
          ],
          { concurrency: "unbounded" },
        );
        yield* Effect.logDebug(
          "Annotations batch read from the Zotero database",
        ).pipe(Effect.annotateLogs({ attachments: attachmentKeys.length }));
        const byKey = new Map(found.map((rows) => [rows.attachmentKey, rows]));
        for (const entry of entries) {
          const rows = byKey.get(entry.request.attachmentKey);
          if (rows)
            entry.completeUnsafe(
              Exit.succeed({ found: rows, libraries, database }),
            );
        }
      }).pipe(Effect.scoped),
  });
}

/** One Attachment's rows from the Zotero database, in this task's batch. */
function databaseRows(
  core: Pick<CoreState, "databaseGeneration" | "databaseRows">,
  attachmentKey: string,
): Effect.Effect<DatabaseAnswer, DatabaseRowsError> {
  return Effect.request(
    new DatabaseRows({ attachmentKey, generation: core.databaseGeneration }),
    core.databaseRows,
  );
}

function demandedSource(core: CoreState): Effect.Effect<LocalApiSource | null> {
  return core.localApi.demandSource;
}

function apiState(core: CoreState): Effect.Effect<LocalApiState> {
  return core.localApi.state;
}

/** Fails where the Zotero database cannot refresh; the previous one keeps serving. */
function refreshZoteroDatabase(core: CoreState) {
  return core.db.refresh;
}

/** After the query client closes, the drop does nothing. */
function invalidate(core: CoreState, queryKey: QueryKey): Effect.Effect<void> {
  return core.queries.invalidate(queryKey);
}

/** After the query client closes, it holds no key. */
function keysUnder(
  core: CoreState,
  prefix: QueryKey,
): Effect.Effect<QueryKey[]> {
  return core.queries.keysUnder(prefix);
}

/** After the query client closes, it holds nothing. */
function peekQuery<T>(
  core: CoreState,
  queryKey: QueryKey,
): Effect.Effect<Held<T> | null> {
  return core.queries.peek<T>(queryKey);
}

/** After the query client closes, the read answers null. */
function readHeldQuery<T>(
  core: CoreState,
  queryKey: QueryKey,
  read: QueryFunction<T>,
): Effect.Effect<T | null> {
  return core.queries.read(queryKey, read);
}

export {
  demandedSource,
  apiState,
  refreshZoteroDatabase,
  invalidate,
  keysUnder,
  peekQuery,
  readHeldQuery,
  databaseRowsResolver,
  databaseRows,
};
export type { DatabaseRowsError };
