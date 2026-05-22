import { type relations } from "@drizzle/relations";
import type * as schema from "@drizzle/schema";
import {
  type BaseSQLiteDatabase,
  type SQLiteSelectBase,
} from "drizzle-orm/sqlite-core";
import {
  type SQLiteRelationalQuery,
  type SQLiteSyncRelationalQuery,
} from "drizzle-orm/sqlite-core/query-builders/query";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

export type SqliteDb = BaseSQLiteDatabase<
  "sync" | "async",
  any,
  typeof schema,
  typeof relations
>;

/**
 * Swap the result-kind generic of a Drizzle builder so a query authored
 * against the sync (Node) client can be re-exposed as the async (Web)
 * client's builder type.
 *
 * Handles three families:
 *   1. Bare {@link SQLiteSyncRelationalQuery} (relational `findMany`/`findFirst`
 *      on a sync session).
 *   2. {@link SQLiteRelationalQuery} of either mode.
 *   3. {@link SQLiteSelectBase} chains — both the bare form and the
 *      `Omit<..., "limit" | ...>` wrappers Drizzle returns after chain ops
 *      like `.limit()` / `.orderBy()`.
 *
 * Specific class checks come before the `Omit` branch because
 * `T extends Omit<infer I, infer E>` matches almost any object structurally
 * (with `E = never`), which would otherwise short-circuit the RQB cases.
 *
 * Note: `TRunResult` (5th param of `SQLiteSelectBase`) is preserved from the
 * source type. That's the node-sqlite `StatementResultingChanges` shape and
 * is only consulted by `.run()` on INSERT/UPDATE/DELETE — fine for shared
 * SELECT queries, wrong if a dual write query is ever introduced.
 */
type SwapKind<T, K extends "sync" | "async"> =
  T extends SQLiteSyncRelationalQuery<infer R>
    ? K extends "async"
      ? SQLiteRelationalQuery<"async", R>
      : T
    : T extends SQLiteRelationalQuery<any, infer R>
      ? SQLiteRelationalQuery<K, R>
      : T extends SQLiteSelectBase<
            infer A,
            any,
            infer C,
            infer D,
            infer E,
            infer F,
            infer G,
            infer H,
            infer I,
            infer J
          >
        ? SQLiteSelectBase<A, K, C, D, E, F, G, H, I, J>
        : T extends Omit<infer Inner, infer Excl>
          ? Inner extends SQLiteSelectBase<
              infer A,
              any,
              infer C,
              infer D,
              infer E,
              infer F,
              infer G,
              infer H,
              infer I,
              infer J
            >
            ? Omit<
                SQLiteSelectBase<A, K, C, D, E, F, G, H, I, J>,
                Excl & keyof any
              >
            : T
          : T;

/**
 * Overloaded callable produced by {@link defineQuery}. Carrying the sync
 * return type on the interface itself (rather than only via SwapKind) lets
 * {@link QueryRow} recover the row shape from the unambiguous Node-side
 * signature, bypassing SwapKind for row extraction.
 */
export interface DefinedQuery<TArgs extends any[], TSyncResult> {
  (db: NodeDatabaseClient, ...args: TArgs): TSyncResult;
  (db: SQLocalDatabaseClient, ...args: TArgs): SwapKind<TSyncResult, "async">;
}

/**
 * Wrap a query whose SQL chain is identical for the sync (node-sqlite) and
 * async (sqlite-proxy / sqlocal) clients, producing a callable that returns
 * the correctly-kinded Drizzle builder per call site.
 *
 * The `refImpl` is typed against {@link NodeDatabaseClient} purely for
 * inference — at runtime the wrapper forwards whichever client was passed,
 * so the returned builder is bound to that client's actual session and
 * `.all()` / `.get()` / `.prepare()` execute against the right driver.
 *
 * @see SwapKind — derives the async builder's type from the sync reference.
 */
export function defineQuery<TArgs extends any[], TSyncResult>(
  refImpl: (db: NodeDatabaseClient, ...args: TArgs) => TSyncResult,
): DefinedQuery<TArgs, TSyncResult> {
  return ((db: NodeDatabaseClient | SQLocalDatabaseClient, ...args: TArgs) =>
    refImpl(db as NodeDatabaseClient, ...args)) as any;
}

/**
 * Extract the row type from a {@link defineQuery}-wrapped query. Works for
 * both select chains and relational `findMany` builders by inferring the
 * sync return type off {@link DefinedQuery}'s first overload and unwrapping
 * Drizzle's `QueryPromise<TResult>`.
 *
 * @example
 *   export const getTopItems = defineQuery((db, limit = 50) => ...);
 *   export type TopItem = QueryRow<typeof getTopItems>;
 */
export type QueryRow<Q> =
  Q extends DefinedQuery<any, infer R>
    ? Awaited<R> extends ArrayLike<infer E>
      ? E
      : never
    : never;
