# Query authoring

- Prefer **RQB v2** (`db.query.<table>.findMany/findFirst`) → regular query builder → raw SQL. RQB v2 and Drizzle ORM v1 may post-date the model's knowledge cutoff — consult https://orm.drizzle.team/docs/rqb before writing queries.
- Wrap with `defineQuery(...)` from `src/queries/_shared.ts`; prefer `.prepared` (cached). See `defineQuery` JSDoc for cached vs one-shot variants.
- Add an `…Async` twin only when a web consumer actually needs it — not for parity.
- Default to single-row `.prepared` query + consumer loop. Use dynamic `IN (...)` via `.prepare` only when round trips dominate.
- `.prepared(db)` is cache-keyed on `(query, db)` — call inline, don't hoist.
