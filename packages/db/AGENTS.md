# @zotlit/db

Zotero database layer — Drizzle schema, typed queries, and domain helpers for reading `zotero.sqlite`. App-agnostic: consumers create a client and call the exports; opening the data directory and watching for changes lives elsewhere.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific tools:

- `pnpm --filter @zotlit/db dev` — tsdown watch.
- `pnpm --filter @zotlit/db db:pull` — drizzle-kit pull.

## Query authoring

See [policies/query-authoring.md](policies/query-authoring.md) for query-builder preference, `defineQuery` wrapping, sync/async variants, and lookup patterns.

See [policies/integer-domains.md](policies/integer-domains.md) for Zotero integer-domain conventions.

## Item fields

Field naming follows type-specific names — `BookSectionFields.bookTitle`, not `publicationTitle`. Use `FIELD_ALIASES` from `@zotlit/zotero-types` for type-specific → base-field resolution.

`fieldsCombined.custom` drives categorization: `0` = built-in (typed property under `item.fields`), `1` = user-defined or newer (entry in `item.customFields`). See `src/queries/items.ts`.

## Date and language parsing

`item.date` and `item.language` are raw strings — the query layer does not parse them. Consumers call `parseItemDate` / `parseItemLanguage` at the use site; language lookup is caller-provided via `createLanguageLookup()`.

## Template data (`zt` variables)

Read `src/lib/context/note-context.ts` for the public seam and `src/lib/context/` for the assembly pipeline.

## Logging

Import `getLogger` directly from `@logtape/logtape` — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
