# @zotlit/db

## Query authoring

Prefer, in order:

1. **Relational query builder (RQB v2)** — see https://orm.drizzle.team/docs/rqb-v2. Use `db.query.<table>.findMany/findFirst` with `with` / `where` / `columns` for anything that maps cleanly onto relations.
2. **Regular query builder** — `db.select().from(...)` etc. — when RQB doesn't fit (custom projections, set ops, complex joins).
3. **Raw SQL** (`sql\`...\``) — last resort, only when the builders cannot express the query.

Prefer **prepared statements with placeholders** (`sql.placeholder("name")`) and cache them via `cachedPrepared()` from [`src/queries/prepared.ts`](src/queries/prepared.ts). The util keys statements per `DatabaseClient` via `WeakMap`, so callers get a single reusable `SQLitePreparedQuery` instead of recompiling on every call.

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "db", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
