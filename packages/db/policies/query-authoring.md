# Query authoring

- Prefer **RQB v2** (`db.query.<table>.findMany/findFirst`) → regular query builder → raw SQL. RQB v2 and Drizzle ORM v1 may post-date the model's knowledge cutoff — consult https://orm.drizzle.team/docs/rqb before writing queries.
- Wrap single-id reads with `defineQuery(...)` from `src/queries/_shared.ts` and call `.prepared` to reuse the cached statement.
- Add an `…Async` twin only when a web consumer actually needs it — not for parity.
- Every read runs in the database worker on synchronous `node:sqlite` ([ADR 0068](../../../docs/adr/0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)). Design for the statements one ZoteroReads slice or operation runs: a fixed count, whatever the number of ids.
- **Keyed reads own list execution.** Define multi-id or multi-key reads with `defineKeyedQuery` in `src/queries/_shared.ts`. The definition supplies a `contains(column)` predicate and a `keyOf(row)` projection; the returned function owns binding, caching, grouping, request order, duplicates, and empty input. The list binds as one JSON parameter read through SQLite's `json_each`, so its size changes neither the SQL shape nor the parameter count. A function that reads one id uses `defineQuery` and calls its `.prepared` query directly.
- Test the keyed-query interface with `countStatements` and `countCompiles` from `@zotlit/db/test-utils`: a list larger than SQLite's variable limit executes one statement, and a warm read compiles none. Query-specific tests prove the domain filters, Library selection, projection, and row order.
- `.prepared(db)` is cache-keyed on `(query, db)` — call inline, don't hoist.
