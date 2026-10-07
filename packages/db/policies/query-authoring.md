# Query authoring

- Prefer **RQB v2** (`db.query.<table>.findMany/findFirst`) → regular query builder → raw SQL. RQB v2 and Drizzle ORM v1 may post-date the model's knowledge cutoff — consult https://orm.drizzle.team/docs/rqb before writing queries.
- Wrap with `defineQuery(...)` from `src/queries/_shared.ts`; prefer `.prepared` (cached). See `defineQuery` JSDoc for cached vs one-shot variants.
- Add an `…Async` twin only when a web consumer actually needs it — not for parity.
- Every read runs in the database worker on synchronous `node:sqlite` ([ADR 0068](../../../docs/adr/0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)). Design for the statements one ZoteroReads slice or operation runs: a fixed count, whatever the number of ids.
- **Batch by default.** Read many ids or keys through `rowsByID` in `src/queries/_shared.ts`. A function that reads one id calls a `.prepared` query directly.
- Prove each multi-id read with `countStatements` from `@zotlit/db/test-utils`: many ids run the same statements as one.
- `.prepared(db)` is cache-keyed on `(query, db)` — call inline, don't hoist.
