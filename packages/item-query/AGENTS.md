# @zotlit/item-query

Item Query over the top-level, non-trashed Items of one or more Target Libraries, as one result set: one deep module whose operations return Effect (v4) values. It contains no SQL; every statement is a reader in `@zotlit/db/item-query`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Tests import the built `@zotlit/db`, so build it first: `turbo run build --filter=@zotlit/db`.

## Effect

- Effect v4 differs from v3. Read the installed source (`node_modules/effect/src`) for API facts.
- The engine has no pause calls. Put each SQL statement and each in-memory chunk in one Effect; `ItemQueryScheduler` (`src/scheduler.ts`) ends a slice. Keep a page or a chunk in the Effect that reads it, so a limited query holds `limit + 1` rows, one page, and one hydrate chunk at most. Effect's default scheduler blocks the Obsidian window.
- Failures: `ItemQueryError` for an invalid request, the tagged errors of `@zotlit/db/item-query` for the database (`ItemQueryLayoutError` for a layout the readers cannot read, `ItemQueryDatabaseError` for a failed statement), interruption for cancellation, a defect for an implementation failure.
- The layout check needs no call: the first reader statement on a copy runs it. An operation that reads the database through the readers gets it.

## Where things go

- A field: one entry in the registry of `src/fields.ts`. Validation, execution, and the Item Query Schema read that registry. The entry's `shape` decides the Projection Paths below it and their JSON types; its `needs` names what the hydrate reader loads.
- The Item Query Schema: `describeItemQuery` in `src/describe-item-query.ts`. It reads the field and function registries and the custom fields of the source, so a new field, function, method, or property appears in the schema with no change there. The `filter` capability of a nested Projection Path is the answer of `planFilter` for the path text: a type, `"any"` for a value whose type depends on the Item (a list element), or `null`. `src/describe-item-query.test.ts` runs every entry of the schema through `queryItems`.
- A relation list (`creators`, `tags`, `collections`) or Attachment presence: the entry names a `HydrateRelation` of `@zotlit/db/item-query` in `needs.relations`; the hydrate reader runs one statement for each named relation.
- A Sortable Field: the `sortKey` of its registry entry, which gives a string, a number, or null. It gets the Query Clock: a calendar-day `accessDate` orders from its start in the query time zone. An entry without `sortKey` fails a sort with `unsortable-field`.
- The string order of sort, ordered comparison, and relation lists: `compareStrings` in `src/collation.ts`.
- A candidate set: `src/candidate-plan.ts`. A leaf form of the Filter Expression that Zotero's indexes answer is one `Lowering` in `LOWERINGS`, which gives a `CandidateLeaf` of `@zotlit/db/item-query`; the reader there has one statement for each leaf kind. A candidate set holds every Item for which the leaf is truthy and may hold more: the universe restriction and the evaluator decide the result. `&&` uses the sides that lower, `||` needs every branch, and every other expression uses the scan.
- The Target Libraries: `libraries` of the request, each as `{ libraryID, groupID }`. The engine reads them one after the other into the one set of matches (`src/query-items.ts`). Each Library has its own Collection paths, candidate plan, row count, and cap, so one Library can read a candidate set while another uses the scan; a scan page, a universe chunk, and a candidate set hold Items of one Library. The result order ends with the Indexed Key, which also orders the same Zotero Key of two Libraries.
- A size or a plan switch of the engine: `ItemQueryTuning` in `src/tuning.ts` (cap ratio, scan page size, hydrate chunk size, merge step size, force-scan), read once for each query. It is internal: `src/index.ts` does not export it.
- The matches a query keeps: `src/matches.ts`. A limited query keeps `limit + 1` rows; an unlimited query keeps one sorted run for each chunk and merges the runs in steps of one Effect each. A match (`Match` in `src/query-items.ts`) has one shape for every query: the scan row, the sort keys, and the Library as its index in `libraries` of the request. An unlimited query holds every match, so keep a match to these three.
- Request validation and defaults: `planRequest` in `src/request.ts`.
- The value of a field in a Filter Expression: the `filter` of its registry entry. An entry without `filter` fails a filter with `unfilterable-field`. A name only a filter reads (`key`) is in `FILTER_ONLY_FIELDS`.
- A function, a method, or a property of the Filter Expression language: one entry in `src/filter-functions.ts`. Its parameters drive the argument checks of validation and execution. A parameter's `type` is one type or a list of types; `nullable` lets a typed parameter take null; `values` is the closed set of texts a string parameter takes (`isType`). The Item Query Schema reports all three.
- Filter validation: `planFilter` in `src/filter-plan.ts`. It gives the typed tree (`FilterNode`) with every name resolved, the hydration needs, and the custom fields for the engine to check against the source. `hasBareForm` decides the bare form of a custom field.
- Filter execution: `src/filter-evaluate.ts` over the values of `src/filter-values.ts`. The evaluator is the authority for every match. A failure that depends on the data of one Item gives null.
- Date and duration values: `src/filter-dates.ts`. The evaluator, each function, and each property get the Query Clock as an argument; `queryItems` reads it once with `readQueryClock` in `src/query-clock.ts`.
- A database read: a reader in `packages/db/src/item-query/`.

## Obsidian adapter

The adapter is `apps/obsidian/src/services/item-query/`; it is the only Promise edge.

- Command names, flags, and `DEFAULT_CLI_LIMIT`: `contract.ts`. The handlers (`cli.ts`) and the guide (`guide.ts`) read them there; the guide also prints `DEFAULT_FIELDS` and `DEFAULT_SORT` of this package.
- The Target Libraries and the query run in one Effect (`run.ts`) under one source lease (`withLease` in `cli.ts`), which also reads the identity of the envelope. Every choice of Libraries is a `LibraryScope`: the one in force (`libraryScope` of the dependencies), All Libraries for `libraries=all`, or Selected Libraries for `library` and `libraries`; `libraries` wins over `library`. `runItemQuery` resolves it with `resolveLibraryScope` on the rows of `readSourceLibraries`. Keep that reader as the source of the rows: `LibraryScopeService.resolveWith` loads them with `getLibraries`, which selects columns by the version stamp. A named scope needs each of its Libraries (`requireEach`).
- A diagnostic code of the adapter and its recovery text: `DIAGNOSTIC_HINTS` in `contract.ts`; the guide prints that list.
- The answer of a query is built in steps after the lease ends (`answerResult` in `cli.ts`): each step takes chunks of rows for `ANSWER_STEP_BUDGET_MS`, half of `SLICE_BUDGET_MS`, then yields with `yieldToMain` and checks the abort signal. One `JSON.stringify` call makes one chunk of about `CHUNK_TEXT_LENGTH`: a few large strings keep V8's scavenges and mark-compact collections out of the steps, where a string for each row put collections of 9 to 110 ms into them. Keep the text byte-identical to `JSON.stringify(envelope, null, 2)`. The measure command (`measure.ts`) reports each step, and the measurement record holds the steps to the slice limits.

## Tests

- The seam is the package interface, run through the real readers on the scenario database (`@zotlit/db/test-scenario`). Assert the public Query Result or the typed failure.
- Evaluator vectors (`src/filter.test.ts`) run a Filter Expression on one Item without a database: function semantics, the null and type matrix, and validation.
- Run every Effect with `runEffect` from `src/test-helpers.ts`: fixed clock, fixed time zone, and a test scheduler that pauses after every operation. `Run.events` holds the statements and the pauses of the run in order.
- Statements and pauses come from two observer services with no-op defaults: `ItemQueryStatementObserver` of `@zotlit/db/item-query` and `ItemQuerySliceObserver` of `src/scheduler.ts`. A test or a measurement provides them; the engine and the scheduler take no option for them.
- The responsiveness invariants (`src/invariants.test.ts`) run on the bulk Library of `@zotlit/db/test-scenario` with the production tuning: the Items one statement reads, a pause between two chunks, the rows a limited query projects, and no statement after a cancel request. Add each new plan path to `PLAN_PATHS` there; an entry with `libraries` runs on several Libraries. Count with the two observers; read no wall time. The suite runs one query in `beforeAll`, so the layout statements of the first read are outside every recorded run. The pause-cancel test runs the query once for each pause, which is quadratic in real `MessageChannel` tasks; `PAUSE_CANCEL_TIMEOUT_MS` gives it the time a busy machine needs.
- The rows a limited query retains (`src/retention.test.ts`) are counted with `WeakRef` and a forced collection. Keep that test in its own file: the file turns off V8's optimizing compilers, because a compilation job holds the closure of a page until the job ends, and that time depends on the load of the machine.
- Override the tuning reference with the `tuning` option of `runEffect`.
- The parity suite (`src/parity.test.ts`) runs every query of `SCENARIO_QUERIES` (`src/scenario-queries.ts`) with each plan and chunk size and compares the complete Query Result, or the typed failure, with the forced scan. Add each new scenario query, leaf, and function to that list: a filter in `FILTERS`, a full request in `REQUESTS`. Each filter runs in each Library and in both Libraries together.
- The suite also generates filter combinations from `GENERATED_FILTER_PARTS` with the fixed seed `GENERATED_SEED`. Add the parts of each new leaf. When a generated query fails, add the entry that the failure message prints to `NAMED_CASES`, then correct the engine.
