// The database batch that each part of the Annotation Repository core reads the Zotero database through.
import {
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Request,
  RequestResolver,
} from "effect";

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
 *
 * A batch that has started runs on `fibers`, the layer's, so the layer's
 * close interrupts it and lets its Snapshot go.
 */
function databaseRowsResolver(
  db: Pick<ZoteroReads["Service"], "snapshot">,
  fibers: FiberSet.FiberSet,
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
      }).pipe(
        Effect.scoped,
        (batch) => FiberSet.run(fibers, batch),
        Effect.flatMap((fiber) => Fiber.join(fiber)),
      ),
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

export { databaseRowsResolver, databaseRows };
export type { DatabaseRowsError };
