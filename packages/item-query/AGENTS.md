# @zotlit/item-query

Item Query over the top-level, non-trashed Items of one Library: one deep module whose operations return Effect (v4) values. It contains no SQL; every statement is a reader in `@zotlit/db/item-query`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Tests import the built `@zotlit/db`, so build it first: `turbo run build --filter=@zotlit/db`.

## Effect

- Effect v4 differs from v3. Read the installed source (`node_modules/effect/src`) for API facts.
- The engine has no pause calls. Put each SQL statement and each in-memory chunk in one Effect; `ItemQueryScheduler` (`src/scheduler.ts`) ends a slice. Keep a page or a chunk in the Effect that reads it, so a limited query holds `limit + 1` rows, one page, and one hydrate chunk at most. Effect's default scheduler blocks the Obsidian window.
- Failures: `ItemQueryError` for an invalid request, the tagged errors of `@zotlit/db/item-query` for the database (`ItemQueryLayoutError` for a layout the readers cannot read, `ItemQueryDatabaseError` for a failed statement), interruption for cancellation, a defect for an implementation failure.
- The layout check needs no call: the first reader statement on a copy runs it. An operation that reads the database through the readers gets it.

## Where things go

- A field: one entry in the registry of `src/fields.ts`. Validation, execution, and the Item Query Schema read that registry. The entry's `shape` decides the Projection Paths below it; its `needs` names what the hydrate reader loads.
- A relation list (`creators`, `tags`, `collections`) or Attachment presence: the entry names a `HydrateRelation` of `@zotlit/db/item-query` in `needs.relations`; the hydrate reader runs one statement for each named relation.
- A Sortable Field: the `sortKey` of its registry entry, which gives a string, a number, or null. An entry without `sortKey` fails a sort with `unsortable-field`.
- The string order of sort, ordered comparison, and relation lists: `compareStrings` in `src/collation.ts`.
- A candidate set: `src/candidate-plan.ts`. A leaf form of the Filter Expression that Zotero's indexes answer is one `Lowering` in `LOWERINGS`, which gives a `CandidateLeaf` of `@zotlit/db/item-query`; the reader there has one statement for each leaf kind. A candidate set holds every Item for which the leaf is truthy and may hold more: the universe restriction and the evaluator decide the result. `&&` uses the sides that lower, `||` needs every branch, and every other expression uses the scan.
- A size or a plan switch of the engine: `ItemQueryTuning` in `src/tuning.ts` (cap ratio, scan page size, hydrate chunk size, merge step size, force-scan), read once for each query. It is internal: `src/index.ts` does not export it.
- The matches a query keeps: `src/matches.ts`. A limited query keeps `limit + 1` rows; an unlimited query keeps one sorted run for each chunk and merges the runs in steps of one Effect each.
- Request validation and defaults: `planRequest` in `src/request.ts`.
- The value of a field in a Filter Expression: the `filter` of its registry entry. An entry without `filter` fails a filter with `unfilterable-field`. A name only a filter reads (`key`) is in `FILTER_ONLY_FIELDS`.
- A function, a method, or a property of the Filter Expression language: one entry in `src/filter-functions.ts`. Its parameters drive the argument checks of validation and execution.
- Filter validation: `planFilter` in `src/filter-plan.ts`. It gives the typed tree (`FilterNode`) with every name resolved, the hydration needs, and the custom fields for the engine to check against the source. `hasBareForm` decides the bare form of a custom field.
- Filter execution: `src/filter-evaluate.ts` over the values of `src/filter-values.ts`. The evaluator is the authority for every match. A failure that depends on the data of one Item gives null.
- Date and duration values: `src/filter-dates.ts`. The evaluator, each function, and each property get the Query Clock as an argument; `queryItems` reads it once with `readQueryClock` in `src/query-clock.ts`.
- A database read: a reader in `packages/db/src/item-query/`.

## Tests

- The seam is the package interface, run through the real readers on the scenario database (`@zotlit/db/test-scenario`). Assert the public Query Result or the typed failure.
- Evaluator vectors (`src/filter.test.ts`) run a Filter Expression on one Item without a database: function semantics, the null and type matrix, and validation.
- Run every Effect with `runEffect` from `src/test-helpers.ts`: fixed clock, fixed time zone, and a test scheduler that pauses after every operation. `Run.events` holds the statements and the pauses of the run in order.
- Statements and pauses come from two observer services with no-op defaults: `ItemQueryStatementObserver` of `@zotlit/db/item-query` and `ItemQuerySliceObserver` of `src/scheduler.ts`. A test or a measurement provides them; the engine and the scheduler take no option for them.
- The responsiveness invariants (`src/invariants.test.ts`) run on the bulk Library of `@zotlit/db/test-scenario` with the production tuning: the Items one statement reads, a pause between two chunks, the rows a limited query retains and projects, and no statement after a cancel request. Add each new plan path to `PLAN_PATHS` there. Count with the two observers; read no wall time.
- Override the tuning reference with the `tuning` option of `runEffect`.
- The parity suite (`src/parity.test.ts`) runs every query of `SCENARIO_QUERIES` (`src/scenario-queries.ts`) with each plan and chunk size and compares the complete Query Result, or the typed failure, with the forced scan. Add each new scenario query, leaf, and function to that list: a filter in `FILTERS`, a full request in `REQUESTS`.
- The suite also generates filter combinations from `GENERATED_FILTER_PARTS` with the fixed seed `GENERATED_SEED`. Add the parts of each new leaf. When a generated query fails, add the entry that the failure message prints to `NAMED_CASES`, then correct the engine.
