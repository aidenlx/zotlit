# @zotlit/db

Zotero database layer for ZotLit — Drizzle schema, typed queries, and domain
helpers for reading `zotero.sqlite`. App-agnostic: consumers create a client and
call the exports; opening the data directory and watching for changes lives
elsewhere.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific tools:

- `pnpm --filter @zotlit/db dev` — tsdown watch.
- `pnpm --filter @zotlit/db db:pull` — drizzle-kit pull.

## Query authoring

Prefer, in order:

1. **Relational query builder (RQB v2)** — see https://orm.drizzle.team/docs/rqb-v2. Use `db.query.<table>.findMany/findFirst` with `with` / `where` / `columns` for anything that maps cleanly onto relations.
2. **Regular query builder** — `db.select().from(...)` etc. — when RQB doesn't fit (custom projections, set ops, complex joins).
3. **Raw SQL** (`sql\`...\``) — last resort, only when the builders cannot express the query.

Wrap queries with `defineQuery(...)` from `src/queries/_shared.ts` and prefer prepared statements with placeholders (`sql.placeholder("name")`). See the `defineQuery` / `DefinedQuery` JSDoc for cached (`.prepared`) vs one-shot (`.prepare`) variants and when to fall back to the bare call.

### Sync vs async variants

Query functions default to the sync `NodeDatabaseClient` (the Obsidian app runs `node:sqlite` on the main thread). The `defineQuery` statement also runs on the web `SQLocalDatabaseClient` (`apps/website`, sqlite-wasm), but that path is `await`-only, so it needs a separate `…Async` twin taking `SQLocalDatabaseClient`.

Add an `…Async` twin only when a web-client consumer actually needs that query — do not add async variants up front for sync/async parity. Mirror the queries-per-feature rule: the twin lands with its first `apps/website` (or other SQLocal) consumer, not before.

### Zotero integer domains

Zotero stores several enum-like domains as raw integers, such as
`itemAttachments.linkMode`, `itemTags.type`, and `creators.fieldMode`.

For these fields:

- Define the int-to-name map **module-private** in the relevant `src/lib/zt-*.ts`
  module (`ANNOT_TYPE`, `LINK_MODE`, `TAG_TYPE`, `CREATOR_FIELD_MODE`). Do not
  export the map. Export the key type and name type derived from it, e.g.
  `LinkMode` / `LinkModeName`, `TagType` / `TagTypeName`.
- Apply the raw key type at the Drizzle schema boundary with
  `integer().$type<...>()` in `drizzle/schema.ts`, preserving nullability from
  Zotero's schema.
- Resolve int→name only through a `<domain>ToName` converter exported from the
  same module (`annotationTypeToName`, `linkModeToName`, `tagTypeToName`,
  `creatorFieldModeToName`). The converter takes the raw key type, returns
  `<Domain>Name | "unknown"`, and `logger.warn`s on a value outside the map so
  Zotero adding a future enum member degrades gracefully instead of throwing. Never index the
  raw map at a call site (`LINK_MODE[mode]`).
- Query models should carry the raw typed integer. Template-facing helpers
  resolve it via the converter when the string name is the template vocabulary.
- Do not add per-query casts for these columns. If a query needs a narrower
  type, fix the schema column typing or add the missing `zt-*` domain type.

### Many-row lookups

Default to a single-row `col = placeholder("col")` query and loop in the consumer (`.prepared`, cached). Use dynamic `col IN (...)` via `.prepare` (uncached) only when the per-row query is heavy enough that N round trips dominate.

`.prepared(db)` is cache-keyed on `(query, db)` and returns the same statement on every call — call it inline at the use site, don't hoist it into a `const stmt` binding.

```ts
// Do — prepared once, reused per key
const q = defineQuery<{ libraryID: number; key: string }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: { libraryID: placeholder("libraryID"), key: placeholder("key") },
    }),
);
return keys.flatMap((key) => q.prepared(db).all({ libraryID, key }));

// Don't — fresh statement per distinct key set
const q = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, args: { keys: readonly string[] }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        key: { in: [...args.keys] },
      },
    }),
);
return q.prepare(db, { keys }).all({ libraryID });
```

## Item fields

`Item = BaseItem & { fields: ItemFields }` — see `src/queries/items.ts` for the type and `toItem` construction; `ItemFields` is the generated discriminated union from `@zotlit/zotero-types` (`packages/zotero-types/src/fields.ts`).

Categorization is driven by `fieldsCombined.custom` at SQL level:

- `custom = 0` (built-in, present in the v42 schema snapshot) → named property nested under `item.fields` (typed via `ItemFields`; `item.fields.itemType` carries the type name).
- `custom = 1` (user-defined, *or* built-ins newer than our snapshot) → entry in `item.customFields: ReadonlyMap<string, string | null>`.

**Field naming follows the schema's type-specific names** — `BookSectionFields.bookTitle`, not `publicationTitle`. To resolve a type-specific name to its canonical base field, use the exported `FIELD_ALIASES` map from `@zotlit/zotero-types` (built from the schema's `baseField` annotations); `baseFieldMappingsCombined` is the DB-level source (see `drizzle/schema.ts`).

To narrow by item type, discriminate on `item.fields`: `if (item.fields.itemType === "bookSection")` narrows it to `BookSectionFields`.

## Date and language parsing

`item.date` and `item.language` are raw `string | null` on the item — the query layer does **not** pre-parse them. Consumers call `parseItemDate(item.date)` / `parseItemLanguage(item.language, lookup)` at the use site. Both are re-exported from `src/index.ts`; see `src/lib/zt-date.ts` and `src/lib/zt-lang.ts` for the `ItemDate` / `ItemLanguage` discriminated unions.

Language name lookup is caller-provided via `createLanguageLookup()` — this package never reads a host locale.

## Template data (`zt` variables)

`src/lib/context/` holds every `zt.*`-shaping module — pure mappers and the DB-fetching orchestrators that assemble them — separate from the raw per-entity mappers (`zt-annot.ts`, `zt-attach.ts`, `zt-collection.ts`, `zt-tag.ts`, etc.) that stay flat in `src/lib/`.

`zt-template-item.ts`, `zt-template-annot.ts`, and `zt-template-attach.ts` define the template-facing interfaces (`TemplateItemData`, `TemplateAnnotation`, `TemplateAttachment`) and pure mappers from DB rows to those shapes. These are the `zt.*` properties users access in Eta templates.

`zt-template-note.ts` assembles the above into `NoteTemplateContext` — the `zt` root for the `note` template — combining item data with attachments, annotations, related items, and resolvers passed in by the caller. Pure and package-private (not exported from `index.ts`).

`note-context.ts` is the public seam: `fetchNoteContext`/`fetchAnnotationsTemplateData` do the DB fetching (queries, tag/collection caching via `TagMemo`/`CollectionCache`) and call the pure builder above. Callers pass only genuinely app-side resolvers (vault paths, note-index lookups, template rendering) via `NoteResolvers`/`AnnotationResolvers`.

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "db", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
