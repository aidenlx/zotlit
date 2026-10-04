import { fillPlaceholders } from "drizzle-orm";
import type { Query } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import type { NodeDatabaseClient } from "@/client/node";
import { defineQuery } from "@/queries/_shared";
import type { QueryOperators } from "@/queries/_shared";

/**
 * A statement of an Item Query reader failed. It carries the statement, in the
 * form of Drizzle's `EffectDrizzleQueryError`.
 */
export class ItemQueryDatabaseError extends Data.TaggedError(
  "ItemQueryDatabaseError",
)<{
  /** The SQL text of the statement. */
  readonly query: string;
  /** The bound values, in statement order. */
  readonly params: readonly unknown[];
  /** The value the SQLite driver threw. */
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Failed query: ${this.query}\nparams: ${JSON.stringify(this.params)}`;
  }
}

/**
 * The database of one Item Query run: the leased client of one source lease.
 * Provide it for each lease; the prepared statements of the readers live as
 * long as the client.
 */
export class ItemQueryDatabase extends Context.Service<
  ItemQueryDatabase,
  { readonly client: NodeDatabaseClient }
>()("@zotlit/db/ItemQueryDatabase") {}

/** One reader statement. `all` runs it when the fiber reaches it. */
export interface Statement<TParams, TRow> {
  all(
    params: TParams,
  ): Effect.Effect<TRow[], ItemQueryDatabaseError, ItemQueryDatabase>;
}

interface Builder<TRow> {
  toSQL(): Query;
  prepare(): { all(params?: Record<string, unknown>): TRow[] };
}

/**
 * Define one reader statement with the Drizzle query builder. The statement is
 * prepared once for each client and reused. This is the one place where a
 * synchronous driver call becomes an Effect and a thrown value becomes
 * {@link ItemQueryDatabaseError}.
 */
export function defineStatement<TParams extends Record<string, unknown>>(): <
  TRow,
>(
  build: (
    db: NodeDatabaseClient,
    operators: QueryOperators<TParams>,
  ) => Builder<TRow>,
) => Statement<TParams, TRow> {
  return <TRow>(
    build: (
      db: NodeDatabaseClient,
      operators: QueryOperators<TParams>,
    ) => Builder<TRow>,
  ) => {
    const query = defineQuery<TParams>()(build);
    const failure = (
      client: NodeDatabaseClient,
      params: TParams,
      cause: unknown,
    ) => {
      const { sql, params: slots } = query(client).toSQL();
      return new ItemQueryDatabaseError({
        query: sql,
        params: fillPlaceholders(slots, params),
        cause,
      });
    };
    return {
      all: (params) =>
        ItemQueryDatabase.use(({ client }) =>
          Effect.try({
            try: () =>
              (
                query.prepared(client) as ReturnType<Builder<TRow>["prepare"]>
              ).all(params),
            catch: (cause) => failure(client, params, cause),
          }),
        ),
    };
  };
}
