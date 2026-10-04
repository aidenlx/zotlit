# @zotlit/item-query

Item Query over the top-level, non-trashed Items of one Library: one deep module whose operations return Effect (v4) values. It contains no SQL; every statement is a reader in `@zotlit/db/item-query`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Tests import the built `@zotlit/db`, so build it first: `turbo run build --filter=@zotlit/db`.

## Effect

- Effect v4 differs from v3. Read the installed source (`node_modules/effect/src`) for API facts.
- The engine has no pause calls. Put each SQL statement and each in-memory chunk in one Effect; `ItemQueryScheduler` (`src/scheduler.ts`) ends a slice. Effect's default scheduler blocks the Obsidian window.
- Failures: `ItemQueryError` for an invalid request, the tagged errors of `@zotlit/db/item-query` for the database, interruption for cancellation, a defect for an implementation failure.

## Where things go

- A field: one entry in the registry of `src/fields.ts`. Validation, execution, and the Item Query Schema read that registry.
- Request validation and defaults: `planRequest` in `src/request.ts`.
- A database read: a reader in `packages/db/src/item-query/`.

## Tests

- The seam is the package interface, run through the real readers on the scenario database (`@zotlit/db/test-scenario`). Assert the public Query Result or the typed failure.
- Run every Effect with `runEffect` from `src/test-helpers.ts`: fixed clock, fixed time zone, and a test scheduler that pauses after every operation and counts its pauses.
