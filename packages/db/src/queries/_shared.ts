import { type relations } from "@drizzle/relations";
import { sql, type DBQueryConfig, type Placeholder } from "drizzle-orm";
import {
  type SQLiteAsyncRelationalQuery,
  type SQLiteAsyncSelectBase,
  type SQLiteSyncRelationalQuery,
} from "drizzle-orm/sqlite-core";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

/**
 * Schema-aware shape of an RQB v2 `findMany` config bound to a specific
 * table in our {@link relations} graph. Pair with `satisfies` so per-key
 * narrow literals (e.g. `orderBy: { x: "asc" }`) survive when the object
 * is later spread into a `findMany` call site.
 *
 * @see DBQueryConfig in drizzle-orm/src/relations.ts
 */
export type FindManyOptions<TName extends keyof typeof relations> =
  DBQueryConfig<"many", typeof relations, (typeof relations)[TName]>;

/**
 * Zotero item types that are excluded from regular-item queries because
 * they represent child rows (file attachments, notes, PDF annotations)
 * rather than first-class library entries.
 */
export const CHILD_ITEM_TYPES = ["attachment", "note", "annotation"] as const;

/**
 * Swap the result-kind generic of a Drizzle builder so a query authored
 * against the sync (Node) client can be re-exposed as the async (Web)
 * client's builder type.
 *
 * Handles two families:
 *   1. Relational `findMany`/`findFirst` builders — always
 *      {@link SQLiteSyncRelationalQuery} on a sync session, swapped to
 *      {@link SQLiteAsyncRelationalQuery} of mode `"async"`.
 *   2. {@link SQLiteAsyncSelectBase} chains — both the bare form and the
 *      `Omit<..., "limit" | ...>` wrappers Drizzle returns after chain ops
 *      like `.limit()` / `.orderBy()`. The result-kind lives in the 2nd type
 *      param (`"sync"` on the Node client, `"async"` on the Web client).
 *
 * The relational check comes before the `Omit` branch because
 * `T extends Omit<infer I, infer E>` matches almost any object structurally
 * (with `E = never`), which would otherwise short-circuit the RQB case.
 *
 * Note: `TRunResult` (3rd param of `SQLiteAsyncSelectBase`) is preserved from
 * the source type. That's the node-sqlite `StatementResultingChanges` shape and
 * is only consulted by `.run()` on INSERT/UPDATE/DELETE — fine for shared
 * SELECT queries, wrong if a dual write query is ever introduced.
 */
type SwapKind<T, K extends "sync" | "async"> =
  T extends SQLiteSyncRelationalQuery<infer R>
    ? K extends "async"
      ? SQLiteAsyncRelationalQuery<"async", R>
      : T
    : T extends SQLiteAsyncSelectBase<
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
      ? SQLiteAsyncSelectBase<A, K, C, D, E, F, G, H, I, J>
      : T extends Omit<infer Inner, infer Excl>
        ? Inner extends SQLiteAsyncSelectBase<
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
              SQLiteAsyncSelectBase<A, K, C, D, E, F, G, H, I, J>,
              Excl & keyof any
            >
          : T
        : T;

type Prepared<T> = T extends { prepare(): infer P } ? P : never;

/**
 * Methods on Drizzle's `SQLitePreparedQuery` that accept the
 * `placeholderValues?: Record<string, unknown>` argument. Re-typed by
 * {@link WithParams} so call sites get strict checking against the query's
 * declared placeholder shape.
 */
type ParamMethods = "run" | "all" | "get" | "values" | "execute";

/**
 * Re-type the placeholder-accepting methods of a Drizzle prepared statement
 * against the query's declared param shape.
 *
 * - `TParams = void` — methods take no args (query has no placeholders).
 * - `TParams = Record<string, unknown>` (the default) — params optional,
 *   matching Drizzle's native loose typing.
 * - Concrete object type (e.g. `{ libraryID: number }`) — params required and
 *   structurally checked at the call site.
 *
 * Non-param methods (`getQuery`, `mapAllResult`, etc.) pass through unchanged.
 */
type WithParams<TPrep, TParams> = Omit<TPrep, ParamMethods> & {
  [K in ParamMethods & keyof TPrep]: TPrep[K] extends (
    pv?: Record<string, unknown>,
    ...rest: infer R
  ) => infer Ret
    ? [TParams] extends [void]
      ? (...rest: R) => Ret
      : [Record<string, unknown>] extends [TParams]
        ? (params?: TParams, ...rest: R) => Ret
        : (params: TParams, ...rest: R) => Ret
    : TPrep[K];
};

/**
 * Typed wrapper for {@link sql.placeholder}. Each query gets a `placeholder`
 * bound to its declared `TParams`, so referencing an unknown placeholder name
 * is a compile error — `placeholder("libraryId")` fails when
 * `TParams = { libraryID: ... }`.
 */
export type ParamsPlaceholder<TParams> = <
  K extends Extract<keyof TParams, string>,
>(
  name: K,
) => Placeholder<K, TParams[K]>;

/**
 * Operators object passed as the second argument to a {@link defineQuery}
 * builder callback. Bundles typed helpers — currently just `placeholder` — so
 * the signature mirrors Drizzle's own RQB operator-bag pattern.
 */
export interface QueryOperators<TParams> {
  placeholder: ParamsPlaceholder<TParams>;
}

/**
 * Values allowed in a builder's cache-key record — primitives and flat
 * readonly arrays of primitives. Anything {@link JSON.stringify} handles
 * deterministically without depth. `undefined` is intentionally excluded so
 * `{ a: undefined }` can't collide with `{ b: undefined }` at the cache key
 * (both would stringify to `{}`). Use the property's `?:` modifier on the
 * args type to express optionality, and omit the key when unset.
 */
type CacheValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

/**
 * Single-arg shape passed to a {@link defineQuery} builder. The same record
 * doubles as the prepared-statement cache key — see {@link cacheKey}.
 */
type CacheArgs = Readonly<Record<string, CacheValue>>;

/**
 * Conditional rest-tuple for the builder-args slot.
 *
 * - `T = Record<string, never>` or all-optional fields → `[args?: T]`.
 * - `T` has any required field → `[args: T]`, so `.prepared(db)` is a
 *   compile error for argful queries.
 *
 * `[Record<string, never>] extends [T]` (tuple-wrapped to disable
 * distribution) is true iff `T` is satisfied by an empty object — i.e. has
 * no required properties.
 */
type ArgsRest<T extends CacheArgs> = [Record<string, never>] extends [T]
  ? [args?: T]
  : [args: T];

/**
 * Overloaded callable produced by {@link defineQuery}.
 *
 * - Bare call returns the Drizzle builder (escape hatch for inspection /
 *   `.toSQL()`; not cached, no TParams typing on `.all`).
 * - `.prepared(db, args)` returns a cached prepared statement, re-typed via
 *   {@link WithParams} so `.all` / `.get` / `.run` / `.values` / `.execute`
 *   check against `TParams`.
 * - `.prepare(db, args)` returns the same typed prepared statement but
 *   without caching — for one-shots where args inline into SQL and the
 *   stringified args would balloon the cache.
 *
 * Carrying the sync return type on the interface itself (rather than only
 * via SwapKind) lets {@link QueryRow} recover the row shape from the
 * unambiguous Node-side signature, bypassing SwapKind for row extraction.
 */
export interface DefinedQuery<
  TParams,
  TBuildArgs extends CacheArgs,
  TSyncResult,
> {
  (db: NodeDatabaseClient, ...rest: ArgsRest<TBuildArgs>): TSyncResult;
  (
    db: SQLocalDatabaseClient,
    ...rest: ArgsRest<TBuildArgs>
  ): SwapKind<TSyncResult, "async">;
  prepared(
    db: NodeDatabaseClient,
    ...rest: ArgsRest<TBuildArgs>
  ): WithParams<Prepared<TSyncResult>, TParams>;
  prepared(
    db: SQLocalDatabaseClient,
    ...rest: ArgsRest<TBuildArgs>
  ): WithParams<Prepared<SwapKind<TSyncResult, "async">>, TParams>;
  prepare(
    db: NodeDatabaseClient,
    ...rest: ArgsRest<TBuildArgs>
  ): WithParams<Prepared<TSyncResult>, TParams>;
  prepare(
    db: SQLocalDatabaseClient,
    ...rest: ArgsRest<TBuildArgs>
  ): WithParams<Prepared<SwapKind<TSyncResult, "async">>, TParams>;
}

type AnyClient = NodeDatabaseClient | SQLocalDatabaseClient;

/**
 * Stable cache key for a builder-args record. Keys are sorted so callers can
 * pass the same logical args in any order and hit the same prepared statement.
 * Returns `""` for undefined / empty input.
 */
function cacheKey(args: CacheArgs | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args).sort();
  if (keys.length === 0) return "";
  const sorted: Record<string, CacheValue> = {};
  for (const k of keys) sorted[k] = args[k]!;
  return JSON.stringify(sorted);
}

/**
 * Wrap a query whose SQL chain is identical for sync (node-sqlite) and async
 * (sqlite-proxy / sqlocal) clients, producing a callable that returns the
 * correctly-kinded Drizzle builder per call site with a per-client
 * prepared-statement cache.
 *
 * Two-step generic: outer `<TParams>` declares placeholder shape; inner call
 * infers builder arg / result types. Use `<void>` for queries with no
 * placeholders; omit the generic for the default loose
 * `Record<string, unknown>` typing.
 *
 * @example
 *   const q = defineQuery<{ libraryID: number }>()((db, { placeholder }) =>
 *     db.select(...).where(eq(t.libraryID, placeholder("libraryID"))),
 *   );
 *   q.prepared(db).all({ libraryID: 1 }); // typed; missing/extra keys error
 */
export function defineQuery<TParams = Record<string, unknown>>(): <
  TBuildArgs extends CacheArgs = Record<string, never>,
  TSyncResult = unknown,
>(
  refImpl: (
    db: NodeDatabaseClient,
    operators: QueryOperators<TParams>,
    args: TBuildArgs,
  ) => TSyncResult,
) => DefinedQuery<TParams, TBuildArgs, TSyncResult> {
  const operators: QueryOperators<TParams> = {
    placeholder: ((name: string) =>
      sql.placeholder(name)) as ParamsPlaceholder<TParams>,
  };

  return <TBuildArgs extends CacheArgs, TSyncResult>(
    refImpl: (
      db: NodeDatabaseClient,
      operators: QueryOperators<TParams>,
      args: TBuildArgs,
    ) => TSyncResult,
  ): DefinedQuery<TParams, TBuildArgs, TSyncResult> => {
    const cache = new WeakMap<AnyClient, Map<string, unknown>>();

    const normalizeArgs = (args: TBuildArgs | undefined): TBuildArgs =>
      (args ?? {}) as TBuildArgs;

    const build = (db: AnyClient, args: TBuildArgs | undefined): TSyncResult =>
      refImpl(db as NodeDatabaseClient, operators, normalizeArgs(args));

    const call = (db: AnyClient, args?: TBuildArgs) => build(db, args);

    const prepared = (db: AnyClient, args?: TBuildArgs) => {
      let perDb = cache.get(db);
      if (!perDb) {
        perDb = new Map();
        cache.set(db, perDb);
      }
      const key = cacheKey(args);
      const hit = perDb.get(key);
      if (hit) return hit;
      const stmt = (build(db, args) as { prepare: () => unknown }).prepare();
      perDb.set(key, stmt);
      return stmt;
    };

    const prepare = (db: AnyClient, args?: TBuildArgs) =>
      (build(db, args) as { prepare: () => unknown }).prepare();

    const fn = call as unknown as DefinedQuery<
      TParams,
      TBuildArgs,
      TSyncResult
    >;
    fn.prepared = prepared as DefinedQuery<
      TParams,
      TBuildArgs,
      TSyncResult
    >["prepared"];
    fn.prepare = prepare as DefinedQuery<
      TParams,
      TBuildArgs,
      TSyncResult
    >["prepare"];
    return fn;
  };
}

/**
 * Extract the row type from a {@link defineQuery}-wrapped query. Works for
 * both select chains and relational `findMany` builders by inferring the
 * sync return type off {@link DefinedQuery}'s first overload and unwrapping
 * Drizzle's `QueryPromise<TResult>`.
 *
 * @example
 *   export const getTopItems = defineQuery()((db, { placeholder }, args) => ...);
 *   export type TopItem = QueryRow<typeof getTopItems>;
 */
export type QueryRow<Q> =
  Q extends DefinedQuery<any, infer _B, infer R>
    ? Awaited<R> extends ArrayLike<infer E>
      ? E
      : never
    : never;
