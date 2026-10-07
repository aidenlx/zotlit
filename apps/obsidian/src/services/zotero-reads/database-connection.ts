// A Connection over the DatabaseService: the handler layer reads the service's client, so the service stays the one database owner.
import { Effect, Layer, Queue, Stream } from "effect";

import type { DatabaseService } from "@/services/database/service";

import { Connection, toDbUnavailable } from "./connection";
import type { ChangeEvent } from "./rpc";

/** The DatabaseService surface the connection uses. */
export type DatabaseConnectionSource = Pick<
  DatabaseService,
  | "ready"
  | "state"
  | "error"
  | "acquireRead"
  | "refresh"
  | "notifyExternalChange"
  | "on"
>;

/**
 * A {@link Connection} whose borrow is a DatabaseService read lease. A borrow
 * defers the service's refresh swaps for as long as it lasts, as a lease does
 * today. Settings reach the DatabaseService directly, so `configure` does
 * nothing.
 */
export function layerDatabaseService(
  db: DatabaseConnectionSource,
): Layer.Layer<Connection> {
  return Layer.succeed(Connection)(
    Connection.of({
      borrow: Effect.acquireRelease(
        Effect.tryPromise({
          try: () => db.acquireRead(),
          catch: toDbUnavailable,
        }),
        (lease) => Effect.sync(() => lease[Symbol.dispose]()),
      ).pipe(Effect.map((lease) => lease.client)),

      // Subscribes at once: the first open can raise `db-file-missing` before
      // the DatabaseService is ready, and raises it only once per launch.
      changes: Stream.callback<ChangeEvent>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const offer = (event: ChangeEvent) =>
              void Queue.offerUnsafe(queue, event);
            // Subscribe in the same step as the seed, so no event falls
            // between the two.
            offer({
              _tag: "state",
              state: db.state,
              error: db.error && toDbUnavailable(db.error),
            });
            return [
              db.on("changed", () => offer({ _tag: "changed" })),
              db.on("degraded", (error) =>
                offer({
                  _tag: "degraded",
                  error: toDbUnavailable(error),
                }),
              ),
              db.on("refresh-failed", (error) =>
                offer({
                  _tag: "refresh-failed",
                  error: toDbUnavailable(error),
                }),
              ),
              db.on("refreshing", (active) =>
                offer({ _tag: "refreshing", active }),
              ),
              db.on("db-file-missing", () =>
                offer({ _tag: "db-file-missing" }),
              ),
            ];
          }),
          (unsubscribes) =>
            Effect.sync(() => {
              for (const unsubscribe of unsubscribes) unsubscribe();
            }),
        ),
      ),

      // `db.refresh()` resolves when a failed refresh leaves the previous
      // client serving; the failure is then in `db.error`.
      refresh: Effect.tryPromise({
        try: () => db.refresh(),
        catch: toDbUnavailable,
      }).pipe(
        Effect.flatMap(() =>
          db.error ? Effect.fail(toDbUnavailable(db.error)) : Effect.void,
        ),
      ),
      notifyExternalChange: Effect.sync(() => db.notifyExternalChange()),
      configure: () => Effect.void,
    }),
  );
}
