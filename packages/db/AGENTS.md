# @zotlit/db

## Query authoring

Prefer, in order:

1. **Relational query builder (RQB v2)** — see https://orm.drizzle.team/docs/rqb-v2. Use `db.query.<table>.findMany/findFirst` with `with` / `where` / `columns` for anything that maps cleanly onto relations.
2. **Regular query builder** — `db.select().from(...)` etc. — when RQB doesn't fit (custom projections, set ops, complex joins).
3. **Raw SQL** (`sql\`...\``) — last resort, only when the builders cannot express the query.

Wrap queries with `defineQuery(...)` from `src/queries/_shared.ts` and prefer prepared statements with placeholders (`sql.placeholder("name")`). See the `defineQuery` / `DefinedQuery` JSDoc for cached (`.prepared`) vs one-shot (`.prepare`) variants and when to fall back to the bare call.

## Item fields

`Item = BaseItem & ItemFields` — see `src/queries/items.ts` for the type and `toItem` construction; `ItemFields` is the generated discriminated union from `@zotlit/zotero-types` (`packages/zotero-types/src/generated.ts`).

Categorization is driven by `fieldsCombined.custom` at SQL level:

- `custom = 0` (built-in, present in the v42 schema snapshot) → named property on the item (typed via `ItemFields`).
- `custom = 1` (user-defined, *or* built-ins newer than our snapshot) → entry in `item.fields: ReadonlyMap<string, string | null>`.

**Field naming follows the schema's type-specific names** — `BookSectionFields.bookTitle`, not `publicationTitle`. The schema's `baseField` aliasing is not reflected in the generated types; if cross-type lookup is ever needed, query `baseFieldMappingsCombined` (see `drizzle/schema.ts`).

To narrow by item type, use the discriminator directly: `if (item.itemType === "journalArticle")`. `ItemOfType<T>` is exported for parameter typing.

## Date and language parsing

`item.date` and `item.language` are raw `string | null` on the item — the query layer does **not** pre-parse them. Consumers call `parseItemDate(item.date)` / `parseItemLanguage(item.language, lookup)` at the use site. Both are re-exported from `src/index.ts`; see `src/lib/zt-date.ts` and `src/lib/zt-lang.ts` for the `ItemDate` / `ItemLanguage` discriminated unions.

Language name lookup is caller-provided via `createLanguageLookup()` — this package never reads a host locale.

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "db", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
