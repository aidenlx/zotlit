// The database seam of Item Query: the leased client as a service, the one
// place where a statement becomes an Effect, and the layout check of a copy.
import { fillPlaceholders, sql } from "drizzle-orm";
import type { AnyColumn, Query, SQL } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import type { NodeDatabaseClient } from "@/client/node";
import {
  columnsByTable,
  hasVersionStamps,
  knownLayout,
  recordLayout,
  selectLayoutColumns,
  selectLayoutVersions,
} from "@/layout";
import type {
  DatabaseLayout,
  LayoutColumnRow,
  LayoutVersionRow,
} from "@/layout";
import { defineQuery } from "@/queries/_shared";
import type { QueryOperators } from "@/queries/_shared";

import { layoutErrorOf } from "./layout";
import type { ItemQueryLayoutError } from "./layout";

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
    return `Failed query: ${this.query}\nparams: ${JSON.stringify(this.params, (_, value: unknown) => (typeof value === "bigint" ? String(value) : value))}`;
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

/**
 * The failures of a reader: a copy whose layout the readers cannot read, or a
 * failed statement.
 */
export type ItemQueryReaderError =
  | ItemQueryLayoutError
  | ItemQueryDatabaseError;

/** The reader a statement belongs to. */
export type ItemQueryReader =
  | "relation-candidate-set"
  | "item-attachments"
  | "item-annotations"
  | "attachment-annotations"
  | "attachment-row-count"
  | "attachment-candidate-set"
  | "attachment-scan-page"
  | "attachment-universe-rows"
  | "attachment-details"
  | "attachment-tags"
  | "annotation-row-count"
  | "annotation-candidate-set"
  | "annotation-scan-page"
  | "annotation-universe-rows"
  | "annotation-details"
  | "annotation-tags"
  | "annotation-attachment-titles"
  | "layout"
  | "libraries"
  | "library-row-count"
  | "scan-page"
  | "candidate-set"
  | "universe-rows"
  | "field-vocabulary"
  | "collection-paths"
  | "hydrate-chunk";

/** One statement that ran to its end. */
export interface StatementRun {
  readonly reader: ItemQueryReader;
  /** The bound values, by placeholder name. */
  readonly params: Readonly<Record<string, unknown>>;
  /** The rows the statement returned, as the reader gets them. */
  readonly rows: readonly unknown[];
}

/**
 * Receives each statement of the Item Query readers when the driver returns
 * its rows, in the same synchronous step as the statement. The default does
 * nothing. A test or a measurement provides a function to count statements
 * and rows; the Obsidian adapter provides none.
 */
export const ItemQueryStatementObserver = Context.Reference<
  (run: StatementRun) => void
>("@zotlit/db/ItemQueryStatementObserver", { defaultValue: () => () => {} });

/** One reader statement. `all` runs it when the fiber reaches it. */
export interface Statement<TParams, TRow> {
  all(
    params: TParams,
  ): Effect.Effect<TRow[], ItemQueryReaderError, ItemQueryDatabase>;
}

/** A statement of the layout reader, which runs before the layout check. */
interface UncheckedStatement<TParams, TRow> {
  all(
    params: TParams,
  ): Effect.Effect<TRow[], ItemQueryDatabaseError, ItemQueryDatabase>;
  /** The SQL text of the statement for one client. */
  readonly sql: (client: NodeDatabaseClient) => string;
}

interface Builder<TRow> {
  toSQL(): Query;
  prepare(): { all(params?: Record<string, unknown>): TRow[] };
}

/** The SQL text of each reader statement, for one client. */
const readerStatements: ((client: NodeDatabaseClient) => string)[] = [];

/**
 * @internal The SQL text of every reader statement defined so far. The layout
 * manifest test compiles each one; load the reader modules first.
 */
export function readerStatementSQL(client: NodeDatabaseClient): string[] {
  return readerStatements.map((sqlOf) => sqlOf(client));
}

/**
 * `column` as a term that no index answers: SQLite's unary `+`. A Zotero
 * database has no `sqlite_stat1`, so the planner takes `items.libraryID = ?`
 * for a selective term and starts the join at every `items` row of the
 * Library, which costs the same for one match as for all. With the Library
 * term outside the indexes, a statement starts at the rows its leaf or its ID
 * list names and checks the Library of each one. It changes speed only.
 */
export function unindexed(column: AnyColumn): SQL {
  return sql`+${column}`;
}

/** A slot of a statement that takes a chunk of Item IDs. */
export type IdSlot = `id${number}`;

/**
 * The ID placeholders of a statement that is prepared once for chunks of at
 * most `size` Item IDs.
 */
export function idSlots(size: number): {
  readonly names: readonly IdSlot[];
  /** The IDs by slot; a slot after the last ID is null. */
  readonly bind: (itemIDs: readonly number[]) => Record<IdSlot, number | null>;
} {
  const names = Array.from({ length: size }, (_, i) => `id${i}` as const);
  return {
    names,
    bind: (itemIDs) =>
      Object.fromEntries(names.map((slot, i) => [slot, itemIDs[i] ?? null])),
  };
}

type Build<TParams, TRow> = (
  db: NodeDatabaseClient,
  operators: QueryOperators<TParams>,
) => Builder<TRow>;

/**
 * Define one reader statement with the Drizzle query builder. The statement is
 * prepared once for each client and reused.
 *
 * A reader statement runs only on a copy that passed the layout check
 * ({@link checkLayout}): every table and column it reads belongs in
 * `ITEM_QUERY_LAYOUT`, and the manifest test fails when one is outside.
 */
export function defineStatement<TParams extends Record<string, unknown>>(
  reader: ItemQueryReader,
): <TRow>(build: Build<TParams, TRow>) => Statement<TParams, TRow> {
  return <TRow>(build: Build<TParams, TRow>) => {
    const statement = uncheckedStatement<TParams, TRow>(reader, build);
    readerStatements.push(statement.sql);
    return {
      all: (params) => Effect.andThen(checkLayout(), statement.all(params)),
    };
  };
}

/**
 * The one place where a synchronous driver call becomes an Effect and a thrown
 * value becomes {@link ItemQueryDatabaseError}. Only the layout reader uses it
 * directly; every other statement comes from {@link defineStatement}.
 */
function uncheckedStatement<TParams extends Record<string, unknown>, TRow>(
  reader: ItemQueryReader,
  build: Build<TParams, TRow>,
): UncheckedStatement<TParams, TRow> {
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
    sql: (client) => query(client).toSQL().sql,
    all: (params) =>
      Effect.gen(function* () {
        const { client } = yield* ItemQueryDatabase;
        const observe = yield* ItemQueryStatementObserver;
        // One synchronous step: no interruption comes between the statement
        // and its report.
        return yield* Effect.suspend(() => {
          let rows: TRow[];
          try {
            rows = (
              query.prepared(client) as ReturnType<Builder<TRow>["prepare"]>
            ).all(params);
          } catch (cause) {
            return Effect.fail(failure(client, params, cause));
          }
          observe({ reader, params, rows });
          return Effect.succeed(rows);
        });
      }),
  };
}

// ---------------------------------------------------------------------------
// The layout reader

const columnsStatement = uncheckedStatement<
  Record<string, never>,
  LayoutColumnRow
>("layout", selectLayoutColumns);

const versionsStatement = uncheckedStatement<
  Record<string, never>,
  LayoutVersionRow
>("layout", selectLayoutVersions);

/**
 * Read the layout of the copy through the Layout module (`src/layout/`), once
 * for each copy. On a copy that a synchronous caller read first, no statement
 * runs; else the two layout statements run through this seam, and the
 * statement observer gets them.
 */
export function readLayout(): Effect.Effect<
  DatabaseLayout,
  ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { client } = yield* ItemQueryDatabase;
    const known = knownLayout(client);
    if (known) return known;
    const columns = columnsByTable(yield* columnsStatement.all({}));
    const versionRows = hasVersionStamps(columns)
      ? yield* versionsStatement.all({})
      : [];
    return recordLayout(client, columns, versionRows);
  });
}

/**
 * Verify that the copy has every table and column of `ITEM_QUERY_LAYOUT`,
 * and give its layout. The layout is read once for each copy and kept for the
 * life of the copy. The version stamps are logged and do not gate the query.
 */
export function checkLayout(): Effect.Effect<
  DatabaseLayout,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.flatMap(readLayout(), (layout) => {
    const error = layoutErrorOf(layout);
    return error ? Effect.fail(error) : Effect.succeed(layout);
  });
}
