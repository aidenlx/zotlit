# @zotlit/db

Zotero database layer — Drizzle schema, typed queries, and domain helpers for reading `zotero.sqlite`. App-agnostic: consumers create a client and call the exports; opening the data directory and watching for changes lives elsewhere.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific tools:

- `pnpm --filter @zotlit/db dev` — tsdown watch.
- `pnpm --filter @zotlit/db db:pull` — drizzle-kit pull.

## Item fields

Field naming follows type-specific names — `BookSectionFields.bookTitle`, not `publicationTitle`. Use `FIELD_ALIASES` from `@zotlit/zotero-types` for type-specific → base-field resolution.

`item.baseFields` carries the same values under their canonical base-field names, resolved against the connected database's own mapping rows so custom item types and custom fields resolve too, and `item.venue` derives the **Venue** from it. `src/queries/_base-fields.ts` owns that mapping for every query that needs it. See [ADR 0026](../../docs/adr/0026-venue-resolves-the-container-role-before-the-publisher-role.md).

`fieldsCombined.custom` drives categorization: `0` = built-in (typed property under `item.fields`), `1` = user-defined or newer (entry in `item.customFields`). See `src/queries/items.ts`.

## Date and language parsing

`item.date` and `item.language` are raw strings — the query layer does not parse them. Consumers call `parseItemDate` / `parseItemLanguage` at the use site; language lookup is caller-provided via `createLanguageLookup()`.

## Template data (`zt` variables)

Read `src/lib/context/note-context.ts` for the public seam and `src/lib/context/` for the assembly pipeline.

### Generated contract artifacts

The `zt` types plus their doc comments are the single source of truth for the template contract. `scripts/generate-contract.ts` extracts them into a contract IR and emits one JSON Schema per data root, both committed under `src/contract/generated/`. `src/contract/roots.ts` holds the Template-slot → root registry the emitter and the Template Workbench CLI share.

- Regenerate with `pnpm --filter @zotlit/db generate:contract` after any contract type or doc-comment change; CI fails on a stale artifact.
- The extractor parses with ts-morph's vendored frozen TypeScript 6, not the repo's TypeScript 7. See [ADR 0015](../../docs/adr/0015-template-contract-artifacts-generate-from-ts-types.md).
- Three doc tags on a contract member carry emitter data: `@ztFilter <name>` names the Liquid filter of a helper member, `@ztInert` (empty tag) marks a helper the resolver can leave inert, and `@example` holds exactly one fenced code block. Any other content in any tag fails the extractor.

## Item Query readers

`src/item-query/` holds every SQL statement of Item Query, behind the `@zotlit/db/item-query` export. It is the only entry that loads `effect`; keep `effect` imports inside it. Define each statement with `defineStatement` in `src/item-query/database.ts`: it is the one place where a driver call becomes an Effect and a thrown value becomes `ItemQueryDatabaseError`. Test readers on the scenario database (`src/test-scenario/`).

A candidate leaf is one kind of `CandidateLeaf` with one statement in `src/item-query/candidate-set.ts`. The statement selects Item IDs of the Target Library with the `limit` of the caller; `readUniverseRows` restricts them to the query universe.

Every table and column a reader statement reads belongs in `ITEM_QUERY_LAYOUT` (`src/item-query/layout.ts`); add them with each new reader. `defineStatement` runs the layout check before the first statement on each copy, and `layout.test.ts` fails when a statement of a reader module that `src/item-query/index.ts` exports reads outside the manifest.

## Logging

Logging uses `@logtape/logtape`; configuration belongs to the consuming app.
