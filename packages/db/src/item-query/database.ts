import { version } from "@drizzle/schema";
import { getLogger } from "@logtape/logtape";
import { fillPlaceholders, inArray, sql } from "drizzle-orm";
import type { Query } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import type { NodeDatabaseClient } from "@/client/node";
import { defineQuery } from "@/queries/_shared";
import type { QueryOperators } from "@/queries/_shared";

import { findLayoutGaps, ItemQueryLayoutError } from "./layout";
import type { LayoutVersions } from "./layout";

const logger = getLogger(["zotlit", "db", "item-query"]);

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

/**
 * The failures of a reader: a copy whose layout the readers cannot read, or a
 * failed statement.
 */
export type ItemQueryReaderError =
  | ItemQueryLayoutError
  | ItemQueryDatabaseError;

/** The reader a statement belongs to. */
export type ItemQueryReader =
  | "layout"
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
  { table: string; column: string }
>("layout", (db) =>
  db
    .select({
      table: sql<string>`m.name`,
      column: sql<string>`c.name`,
    })
    .from(
      sql`sqlite_schema as m join pragma_table_info(m.name) as c where m.type in ('table', 'view')`,
    ),
);

const versionsStatement = uncheckedStatement<
  Record<string, never>,
  {
    schema: string;
    version: number;
  }
>("layout", (db) =>
  db
    .select({ schema: version.schema, version: version.version })
    .from(version)
    .where(inArray(version.schema, ["userdata", "compatibility"])),
);

/**
 * Read the layout of the copy: the columns of each table and view, and the
 * `userdata` and `compatibility` stamps when the copy has a `version` table.
 */
export function readLayout(): Effect.Effect<
  {
    columns: ReadonlyMap<string, ReadonlySet<string>>;
    versions: LayoutVersions;
  },
  ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const columns = new Map<string, Set<string>>();
    for (const row of yield* columnsStatement.all({})) {
      let table = columns.get(row.table);
      if (!table) columns.set(row.table, (table = new Set()));
      table.add(row.column);
    }
    const stamped =
      columns.get("version")?.has("schema") &&
      columns.get("version")?.has("version");
    const rows = stamped ? yield* versionsStatement.all({}) : [];
    const stamp = (schema: string) => {
      const value = rows.find((row) => row.schema === schema)?.version;
      return typeof value === "number" ? value : null;
    };
    return {
      columns,
      versions: {
        userdata: stamp("userdata"),
        compatibility: stamp("compatibility"),
      },
    };
  });
}

/** The check result of each copy; a copy has one client. */
const checkedCopies = new WeakMap<
  NodeDatabaseClient,
  ItemQueryLayoutError | null
>();

/**
 * Verify once for each copy that it has every table and column of
 * `ITEM_QUERY_LAYOUT`. The result is kept for the life of the copy. The
 * version stamps are logged and do not gate the query.
 */
export function checkLayout(): Effect.Effect<
  void,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { client } = yield* ItemQueryDatabase;
    let result = checkedCopies.get(client);
    if (result === undefined) {
      const layout = yield* readLayout();
      const missing = findLayoutGaps(layout.columns);
      result =
        missing.length === 0
          ? null
          : new ItemQueryLayoutError({ missing, versions: layout.versions });
      checkedCopies.set(client, result);
      if (result) {
        logger.warn(
          "Item Query cannot read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility}): {message}",
          { ...layout.versions, message: result.message },
        );
      } else {
        logger.info(
          "Item Query read the layout of the Zotero database (userdata {userdata}, compatibility {compatibility})",
          { ...layout.versions },
        );
      }
    }
    if (result) return yield* Effect.fail(result);
  });
}
