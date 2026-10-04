# Item Query correctness oracle

Date: 2026-08-02

## Scope

This note resolves the evidence question in [#598](https://github.com/aidenlx/zotlit/issues/598). It uses only primary sources in this repository: the settled Item Query ADRs and contexts, the current Filter Expression and database tests, and the last complete `@zotlit/bases-query` proof-of-concept snapshot at commit [`71362fa0`](https://github.com/aidenlx/zotlit/commit/71362fa09cce268476321a0f40a0595ee29c73de).

## Result

Build the oracle as a small, committed behavior corpus plus a deterministic SQLite seed. Run each public query against an authoritative full evaluator and against each optimized plan. Compare the complete normalized Query Result. Keep parser cases in `@zotlit/filter-expression`, evaluator and query cases in `@zotlit/item-query`, and Zotero storage-decoding cases in `@zotlit/db`.

The proof of concept supplies valuable expected values. Its package layout, AST, multiple-view configuration, SQL fragments, candidate counts, relation preload strategy, and error classes are implementation evidence. They are outside the Item Query contract. The current contract hides those parts behind `queryItems` and `describeItemQuery` ([ADR 0066:3-7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L3-L7)).

The old engine lives on the separate `feat/base-syntax` history. The current line re-established the language oracle in [`3eec28e3`](https://github.com/aidenlx/zotlit/commit/3eec28e317de997975699fb4212c54e99c50fbc8) and settled the Item Query contract in [`b1c6789e`](https://github.com/aidenlx/zotlit/commit/b1c6789ed83c122f21fa533d08cca099d285bd36). Use the final old snapshot for evidence and the current line for authority.

## Authority order

Use this order when two sources disagree:

1. The settled Item Query ADRs and context define the public result, validation, projection, ordering, and execution contract. They adopt the proof of concept's evaluator semantics for aliases, custom fields, relations, partial dates, Temporal values, null propagation, and functions ([ADR 0063:3-5](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md#L3-L5), [ADR 0064:3-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L3-L15), [Item Query glossary:7-32](../../packages/item-query/GLOSSARY.md#L7-L32)).
2. Current focused tests own Filter Expression syntax. ZotLit owns this language, and repository tests specify its supported behavior ([ADR 0062:1-3](../adr/0062-zotlit-owns-filter-expression-language.md#L1-L3), [`parse.test.ts:96-888`](../../packages/filter-expression/src/parse.test.ts#L96-L888)).
3. Current `@zotlit/db` tests own decoding from Zotero storage into Items and template-style values. They already cover the Item universe, custom-field classification, field aliases, creator shape, partial Zotero dates, Tags, Collections, and Attachments ([`items.test.ts:44-245`](../../packages/db/src/queries/items.test.ts#L44-L245), [`zt-date.test.ts:7-214`](../../packages/db/src/lib/zt-date.test.ts#L7-L214), [`zt-template-item.test.ts:34-244`](../../packages/db/src/lib/context/zt-template-item.test.ts#L34-L244)).
4. The final proof-of-concept tests supply evaluator examples and optimizer parity examples. Use their observable inputs and outputs as seeds, subject to the replacements below. The historical package itself stated that the evaluator was authoritative and SQL supplied only a sound over-approximation ([`CONTEXT.md@71362fa0`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/CONTEXT.md), [`query.fixture.test.ts@71362fa0:482-509`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L482-L509)).

At the current branch snapshot, `packages/item-query` has its context document and no implementation tests. Therefore, the first Item Query test corpus must make the adopted behavior executable instead of depending on the removed proof-of-concept package.

## Proof-of-concept behaviors to carry forward

### Evaluator values and operators

The proof of concept used the value domain `null | boolean | number | string | list | date | duration`. Truthiness treated null, empty lists, zero-length strings, zero, false, and zero durations as false; dates and non-empty lists were true. Loose equality made null equal only null, compared lists element by element, unwrapped a one-element list for equality, compared dates by interval overlap, and used JavaScript loose equality for the remaining primitives ([`values.ts@71362fa0:9-102`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/values.ts#L9-L102), [`query.test.ts@71362fa0:103-148`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L103-L148)).

The adopted operator examples include numeric arithmetic, string concatenation, list concatenation, null propagation for invalid numeric arithmetic, calendar-aware date-duration arithmetic, short-circuit `&&` and `||`, and the lazy `if()` special form. Relational comparison propagates null, compares two numbers numerically, converts other non-date values to strings, and coerces a string to a date when the other operand is a date ([`eval.ts@71362fa0:117-246`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/eval.ts#L117-L246), [`query.test.ts@71362fa0:119-160`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L119-L160)).

Object and array access examples cover string length, positive and negative list indexes, out-of-range access as null, and access through a null subject as null. The old evaluator treated an unknown property on a non-null runtime value as an evaluation error ([`query.test.ts@71362fa0:188-197`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L188-L197), [`eval.ts@71362fa0:248-289`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/eval.ts#L248-L289)).

The function corpus covers these adopted families:

- `now`, `today`, `date`, `duration`, `number`, `min`, `max`, and lazy `if`;
- `toString` and `isType` across values;
- string `contains`, `containsAny`, `containsAll`, `startsWith`, `endsWith`, `lower`, and `isEmpty`;
- list `contains`, `containsAny`, `containsAll`, and `isEmpty`;
- number `round`, `ceil`, `floor`, `abs`, and `isEmpty`;
- date `format`, `relative`, `date`, `time`, and `isEmpty`.

Names were case-insensitive. Required null arguments returned null. Wrong arity and wrong non-null argument types raised evaluation errors ([`functions.ts@71362fa0:43-73`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/functions.ts#L43-L73), [`query.test.ts@71362fa0:339-439`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L339-L439)).

Use a fixed clock and an explicit time-zone input in the oracle. The old unit harness fixed one instant for deterministic `now()` and `today()` checks, while the implementation derived `today()` from the host time zone ([`query.test.ts@71362fa0:27-38`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L27-L38), [`functions.ts@71362fa0:118-149`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/functions.ts#L118-L149)). The production evaluator must receive that clock and time-zone dependency or define one stable zone in its contract.

### Partial dates

Carry forward the closed-interval comparison model:

| Operation | Expected interval result |
| --- | --- |
| `a > b` | `a` starts after `b` ends |
| `a >= b` | some part of `a` is on or after the start of `b` |
| `a < b` | `a` ends before `b` starts |
| `a <= b` | some part of `a` is on or before the end of `b` |
| `a == b` | the intervals overlap |
| `a != b` | the intervals do not overlap |

When both operands contain a time, compare exact instants. When only one contains a time, compare their day intervals. Sort date values by the lower interval bound ([`values.ts@71362fa0:319-415`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/values.ts#L319-L415), [`query.test.ts@71362fa0:227-246`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L227-L246), [`query.test.ts@71362fa0:308-336`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L308-L336)).

The current database parser is the input-decoding authority. It preserves full dates, year-months, years, text with or without an extracted year, and the raw source. It degrades an impossible day to year-month and a year-plus-day-without-month to year precision ([`zt-date.ts:88-167`](../../packages/db/src/lib/zt-date.ts#L88-L167), [`zt-date.test.ts:14-125`](../../packages/db/src/lib/zt-date.test.ts#L14-L125)). The proof of concept then converted a text date with a four-digit year to a year interval and converted text without a year to null ([`values.ts@71362fa0:158-181`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/values.ts#L158-L181), [`query.test.ts@71362fa0:295-306`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L295-L306)).

Retain the historical fixture assertions as distribution evidence, not as the reusable corpus. They depended on a developer-local database path and pinned private-library counts, including 24,352 top-level Items and 123 null-equivalent bibliographic dates ([`test-db.ts@71362fa0:20-29`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/test-db.ts#L20-L29), [`query.fixture.test.ts@71362fa0:356-453`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L356-L453)).

### Field aliases and custom fields

The old resolver checked a built-in field first, then a same-named custom field, then the type-specific variants of a base field. This let `publicationTitle` resolve `bookTitle` and `proceedingsTitle`, while a direct type-specific name stayed specific to that Item type ([`resolve.ts@71362fa0:26-49`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L26-L49), [`resolve.ts@71362fa0:104-138`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L104-L138), [`query.fixture.test.ts@71362fa0:239-277`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L239-L277)). Carry forward the alias results, not the old resolver order.

The current database layer classifies `fieldsCombined.custom = 1` values into `Item.customFields` and keeps built-ins under `Item.fields` ([`items.ts:173-211`](../../packages/db/src/queries/items.ts#L173-L211), [`items.test.ts:123-131`](../../packages/db/src/queries/items.test.ts#L123-L131)). Item Query adds a `custom` object so exact custom names cannot collide with reserved fields. It also allows a bare custom identifier only when the name is identifier-safe and non-colliding ([ADR 0064:7-11](../adr/0064-item-query-has-a-field-oriented-contract.md#L7-L11)). Therefore, corpus cases must distinguish `title` from `custom["title"]` and must preserve punctuation and case in names such as `custom["review.status"]`.

The template mapper proves useful source normalization: built-in aliases map to canonical names, built-ins win over direct custom-name collisions in that template surface, and empty built-in or custom strings are omitted ([`zt-template-item.ts:234-289`](../../packages/db/src/lib/context/zt-template-item.ts#L234-L289), [`zt-template-item.test.ts:69-91`](../../packages/db/src/lib/context/zt-template-item.test.ts#L69-L91), [`zt-template-item.test.ts:218-244`](../../packages/db/src/lib/context/zt-template-item.test.ts#L218-L244)). Item Query's explicit `custom` object supersedes that direct-property collision behavior for exact custom access.

### Relations

For filtering, carry forward these proof-of-concept values:

- creators are an ordered string list. A personal creator is `given + family`; an institutional creator uses the stored literal name;
- Tags and Collections are string lists;
- Attachment presence is a boolean;
- an absent list is an empty list and absent Attachment presence is false.

The old resolver and fixture cover creator storage modes, presence truthiness, Tags, and empty Collections and Attachments ([`resolve.ts@71362fa0:51-101`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L51-L101), [`resolve.ts@71362fa0:140-156`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L140-L156), [`query.fixture.test.ts@71362fa0:279-304`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L279-L304)). The settled contract keeps these string-list filter values while projection exposes richer template-style structures ([ADR 0064:7-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L7-L15)).

Current database fixtures add relation facts that the old end-to-end fixture lacked. Tags are alphabetical per Item and deleted Items return no Tags ([`tags.test.ts:30-68`](../../packages/db/src/queries/tags.test.ts#L30-L68)). Collections exclude trashed memberships, return root-to-leaf paths, and sort by name ([`collections.test.ts:28-81`](../../packages/db/src/queries/collections.test.ts#L28-L81)). Attachment loading excludes deleted Attachments and distinguishes no Attachments from a live result ([`attachments.test.ts:25-62`](../../packages/db/src/queries/attachments.test.ts#L25-L62)). Use these facts in the seeded corpus.

Zotero `itemRelations` are a separate database concept. Current tests select only forward `dc:relation` Item URIs and ignore other predicates, inverse edges, and non-Item URIs ([`item-relations.test.ts:24-51`](../../packages/db/src/queries/item-relations.test.ts#L24-L51)). The settled Item Query relation vocabulary names creators, Tags, Collections, and Attachment presence. Add related Items only after the Item Query Schema declares that capability ([ADR 0063:3](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md#L3)).

### Nulls and missing values

Retain these evaluator distinctions:

- a known field missing on one Item evaluates as null;
- equality makes null equal only null, so `missing != "x"` is true;
- a relational operation with null returns null, and a filter treats that as no match;
- a method or access through null returns null where the evaluator defines null propagation;
- missing relation lists are empty lists and missing Attachment presence is false;
- requested missing Projection Paths remain present with null, while empty relation-list projections remain empty lists.

The old evaluator and fixture cover the first four distinctions ([`query.test.ts@71362fa0:113-123`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L113-L123), [`query.fixture.test.ts@71362fa0:113-131`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L113-L131)). The current contract defines the validation boundary and projection distinctions: an unknown schema path is a request error, a known field missing from an Item is null, and an empty relation is an empty list ([ADR 0064:11-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L11-L15)).

### Errors

The current contract controls error behavior. Invalid requests reject once with a typed `ItemQueryError` that has a stable code, location, message, and recovery hint. Cancellation, database failures, and implementation defects remain distinct ([ADR 0066:7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L7)). Unknown fields, functions, and unsupported capabilities fail validation before database execution ([ADR 0064:9-11](../adr/0064-item-query-has-a-field-oriented-contract.md#L9-L11)).

Reuse the proof-of-concept error inputs: malformed expressions, bad function arity and types, regexp literals, vault-only roots, relation sort attempts, and unsupported functions. Replace the expected old classes and per-view result shapes with `ItemQueryError` expectations ([`query.test.ts@71362fa0:40-100`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L40-L100), [`query.test.ts@71362fa0:150-197`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L150-L197), [`query.fixture.test.ts@71362fa0:181-229`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L181-L229)).

The current parser returns a tree and the first syntax-error range in UTF-16 offsets. It treats empty and whitespace-only input as syntax errors ([`index.ts:8-35`](../../packages/filter-expression/src/index.ts#L8-L35), [`parse.test.ts:692-725`](../../packages/filter-expression/src/parse.test.ts#L692-L725), [`parse.test.ts:818-888`](../../packages/filter-expression/src/parse.test.ts#L818-L888)). Item Query also states that an omitted filter matches all and an explicitly empty filter is invalid ([ADR 0065:5-7](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L5-L7)). This replaces the proof of concept's empty-filter-as-null behavior.

### Ordering, limit, and truncation

Retain multi-key ordering, nulls last in both directions, partial-date lower-bound ordering, and limit application after complete filter and sort evaluation. The proof-of-concept fixture covers these behaviors ([`query.fixture.test.ts@71362fa0:141-179`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L141-L179), [`query.fixture.test.ts@71362fa0:417-453`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L417-L453)).

Use Indexed Key as the stable final tie-breaker for every explicit and default sort. This is the settled Sortable Field rule ([Item Query glossary:23-25](../../packages/item-query/GLOSSARY.md#L23-L25)). The old in-memory sort returned equality after the requested keys and relied on input stability, while its SQL sort tail used `itemID`; neither tail is the Item Query contract ([`index.ts@71362fa0:582-625`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L582-L625), [`to-sql.test.ts@71362fa0:233-260`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/to-sql.test.ts#L233-L260)).

For the CLI, the default order is descending modification time, the default limit is 100, numeric limits are positive integers, and `limit=all` normalizes to no limit. The package operation is unbounded when the caller omits its limit ([ADR 0065:3-9](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L3-L9)). This replaces the old negative-limit behavior. The oracle must also check `returnedCount` and `truncated`, including the one-extra-match rule for a final SQL order and the full-scan rule for an in-memory sort ([ADR 0065:7](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L7)).

### SQL pushdown parity

Preserve one optimizer rule: SQL can select a sound candidate superset, and the full evaluator decides every result. Compare optimized execution with a full-evaluator plan over the same public query and source ([ADR 0063:5](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md#L5)).

The historical parity suite compared error objects and ordered Item keys between hybrid and pure execution. It stressed Item type and key predicates, field aliases and presence, Unicode and SQL `LIKE` metacharacters, timestamp and bibliographic dates, negation of exact and inexact leaves, relations, mixed SQL and in-memory sorts, limits, unsupported vocabulary, and multi-view fetch sharing ([`query.fixture.test.ts@71362fa0:482-692`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L482-L692)). Carry the semantic cases into one-query Item Query tests. Exclude multi-view fetch sharing because Item Query owns one result set.

The historical lowering tests are useful adversarial input generators. They distinguish exact predicates, superset-only EAV and `LIKE` predicates, untranslatable leaves, negation, AND/OR absorption, ASCII-only `LIKE` lowering, escaped `%`, `_`, and `\\`, and unsupported expressions that could be hidden by narrowing ([`to-sql.test.ts@71362fa0:47-230`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/to-sql.test.ts#L47-L230)). Do not assert the old Drizzle fragment shape, exact flag, candidate count, pushed-sort set, or memoization count. Those are planner choices hidden by `queryItems` ([ADR 0066:3](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L3)).

## Proof-of-concept behaviors to replace

| Proof-of-concept behavior | Item Query behavior |
| --- | --- |
| Blank input becomes a null literal and matches nothing ([`ast.ts@71362fa0:53-71`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/ast.ts#L53-L71)). | Omitted filter matches all. Explicit empty input is invalid ([ADR 0065:7](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L7)). |
| An unknown identifier resolves to null ([`resolve.ts@71362fa0:64-123`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L64-L123)). | An unknown schema field fails the query; a known field absent on one Item is null ([ADR 0064:11](../adr/0064-item-query-has-a-field-oriented-contract.md#L11)). |
| A Base configuration owns global filters, named views, view filters, inheritance, and per-view errors ([`index.ts@71362fa0:150-239`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L150-L239)). | One Item Query produces one Query Result; a future Base adapter owns document structure ([ADR 0063:3](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md#L3)). |
| Projection is a view `order` list stored in a `Map`, and relation sort keys get an old view error ([`query.fixture.test.ts@71362fa0:323-346`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L323-L346), [`query.fixture.test.ts@71362fa0:456-467`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L456-L467)). | Projection uses documented Projection Paths in a flat `values` map. Sorting validates top-level scalar fields through the schema ([ADR 0064:3-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L3-L15)). |
| Equal sort keys retain fetch order in memory; pushed timestamp sorts end with `itemID` ([`index.ts@71362fa0:604-624`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L604-L624), [`to-sql.test.ts@71362fa0:233-247`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/to-sql.test.ts#L233-L247)). | Indexed Key is the final tie-breaker ([Item Query glossary:23-25](../../packages/item-query/GLOSSARY.md#L23-L25)). |
| A negative limit means unlimited and the result has no truncation metadata ([`query.fixture.test.ts@71362fa0:232-237`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L232-L237)). | Numeric CLI limits are positive; normalized results include `returnedCount` and `truncated` ([ADR 0065:5-7](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L5-L7)). |
| Unsupported runtime vocabulary could be hidden by short-circuit or candidate narrowing, so the old planner scanned broadly ([`index.ts@71362fa0:256-288`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L256-L288)). | Schema validation rejects unknown fields, functions, and unsupported capabilities before database execution ([ADR 0064:9-11](../adr/0064-item-query-has-a-field-oriented-contract.md#L9-L11)). |

## Missing adversarial cases

### Required for the first reusable corpus

1. **Tie-heavy ordering.** Seed several Items with equal primary and secondary sort values, missing values, identical timestamps, and personal/group Indexed Keys. Assert the Indexed Key tail in ascending and descending user sorts and in the default order. The historical fixture asserted extrema but never a complete tie group; its sorter had a different tail ([`query.fixture.test.ts@71362fa0:141-179`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L141-L179), [Item Query glossary:23-25](../../packages/item-query/GLOSSARY.md#L23-L25)).
2. **Non-empty Collection and Attachment filters.** The old end-to-end database contained no Collection memberships or Attachments, so those evaluator paths only proved empty behavior ([`query.fixture.test.ts@71362fa0:291-304`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L291-L304)). Seed live and deleted Attachments, multiple Collection paths, equal leaf names under different parents, a trashed membership, and a live Collection below a trashed ancestor. Current database tests already define the source behavior ([`collections.test.ts:28-81`](../../packages/db/src/queries/collections.test.ts#L28-L81), [`attachments.test.ts:25-47`](../../packages/db/src/queries/attachments.test.ts#L25-L47)).
3. **Custom-name hazards.** Seed `review.status`, spaces, quotes, brackets, backslashes, non-ASCII text, an identifier-safe name, a reserved-name collision such as `title`, an alias collision such as `publicationTitle`, an empty value, and a missing value. Assert `custom["exact name"]`, bare-name eligibility, schema discovery, filter, projection, and null behavior. Existing tests cover only simple names such as `mood` and `myCustomField` ([`items.test.ts:123-131`](../../packages/db/src/queries/items.test.ts#L123-L131), [`zt-template-item.test.ts:160-169`](../../packages/db/src/lib/context/zt-template-item.test.ts#L160-L169)).
4. **Alias conflicts.** Seed an Item that has both a base field and one of its type-specific variants, plus a custom field with either name. Record one Item Query resolution rule and use it for filter, projection, sort, and SQL parity. The old resolver's priority was implementation structure, and current mapper tests cover one alias at a time ([`resolve.ts@71362fa0:104-123`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/resolve.ts#L104-L123), [`zt-template-item.test.ts:69-91`](../../packages/db/src/lib/context/zt-template-item.test.ts#L69-L91)).
5. **Unicode folding hazards.** Include ASCII, accents, Turkish dotted `İ`, Kelvin sign `K`, combining marks, emoji, `%`, `_`, and `\\` in both haystacks and needles. The old parity corpus tested broad Unicode and SQL wildcards but explicitly left exotic Unicode-to-ASCII lowercase mappings as an assumption ([`CONTEXT.md@71362fa0`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/CONTEXT.md), [`query.fixture.test.ts@71362fa0:541-559`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L541-L559)).
6. **Validation in dead branches.** Unknown fields, functions, regexp capability, and invalid Projection Paths must fail even inside `false && ...`, `true || ...`, and an unselected `if` branch. This verifies pre-execution schema validation and removes dependence on evaluator traversal order ([ADR 0064:9-11](../adr/0064-item-query-has-a-field-oriented-contract.md#L9-L11)).
7. **Null/type matrix.** Cross each operator and supported function with null, empty string, zero, false, empty list, one-element list, multi-element list, date, duration, wrong non-null type, and a missing known field. The old tests contain selected examples rather than a full matrix ([`query.test.ts@71362fa0:103-197`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L103-L197), [`query.test.ts@71362fa0:339-439`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L339-L439)).
8. **Date boundaries.** Add month-end, year-end, leap day, non-leap invalid day, precise-versus-partial operands in both orders, explicit offsets that cross UTC day boundaries, fractional seconds, text with one or multiple years, and text outside the parser's 1000-2999 extraction range. Current date parsing and old interval comparison cover parts of this matrix separately ([`zt-date.test.ts:101-125`](../../packages/db/src/lib/zt-date.test.ts#L101-L125), [`zt-date.test.ts:180-214`](../../packages/db/src/lib/zt-date.test.ts#L180-L214), [`query.test.ts@71362fa0:200-336`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.test.ts#L200-L336)).
9. **Relation duplicates and case.** Add repeated creator display names with different roles, personal and institutional creators, blank creator components, manual and automatic Tags with similar names, duplicate Collection leaf names, and Items with only deleted relations. Current loaders define ordering and deletion, while the old evaluator only checked two creator modes and one Tag value ([`items.test.ts:147-165`](../../packages/db/src/queries/items.test.ts#L147-L165), [`tags.test.ts:30-59`](../../packages/db/src/queries/tags.test.ts#L30-L59), [`query.fixture.test.ts@71362fa0:279-304`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L279-L304)).
10. **Limit and truncation boundaries.** Cover zero matches, exactly `limit` matches, `limit + 1`, null-heavy sorts, residual filters after SQL candidates, and all matches with an in-memory sort. Compare rows, order, `returnedCount`, and `truncated`. The settled contract distinguishes final SQL order from in-memory sorting ([ADR 0065:7](../adr/0065-item-query-cli-is-versioned-and-self-describing.md#L7)).
11. **Duplicate SQL candidates.** Seed one Item that matches several alias field IDs, several Tags, and several Collections in the same lowered predicate. Assert one Query Row per Indexed Key before order and limit. The old EAV lowering expanded aliases to several field IDs, and the database bridges allow several relation rows per Item ([`to-sql.test.ts@71362fa0:80-93`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/to-sql.test.ts#L80-L93), [`test-utils.ts:60-81`](../../packages/db/src/test-utils.ts#L60-L81), [`test-utils.ts:137-172`](../../packages/db/src/test-utils.ts#L137-L172)).
12. **Projection-path null and list boundaries.** Request a missing known scalar, a missing custom value, an out-of-range creator index, an Item with no Tags or Collections, and a malformed or unknown path. Assert null for the first three, empty lists for empty relations, and a preflight request error for the last case ([ADR 0064:13-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L13-L15)).

### Decisions that need an explicit case before implementation

The adopted sources do not fully settle these details. Record each choice in the shared corpus so the first implementation cannot select it accidentally:

- whether a type or arity error in a known function is a request-validation error or a per-Item false result; the old query wrapper converted ordinary evaluator errors to false, while unknown vocabulary failed the view ([`index.ts@71362fa0:560-579`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L560-L579));
- the explicit time-zone input for `today()` and `relative()`, because the old implementation read the host zone ([`functions.ts@71362fa0:118-149`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/functions.ts#L118-L149));
- collation for ordinary scalar sorting, including case, accents, normalization, and numeric-looking strings; the old in-memory sorter used JavaScript string `<` while current Tag and Collection loaders use their own alphabetical operations ([`index.ts@71362fa0:604-624`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/index.ts#L604-L624), [`collections.ts:55-56`](../../packages/db/src/lib/zt-collection.ts#L55-L56));
- the exact bare-name eligibility and precedence for a custom field that collides with a generated alias; the ADR defines safe, non-colliding bare names but leaves registry construction to Item Query ([ADR 0064:11](../adr/0064-item-query-has-a-field-oriented-contract.md#L11));
- whether relation list equality preserves duplicate values or treats relations as sets; the old evaluator compared arrays positionally and the relation sources normally deduplicate through database keys ([`values.ts@71362fa0:70-101`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/values.ts#L70-L101), [`test-utils.ts:137-172`](../../packages/db/src/test-utils.ts#L137-L172)).

## Recommended reusable corpus

### 1. Syntax corpus

Keep the current parser tests in `packages/filter-expression/src/parse.test.ts`. They already specify literals, Unicode identifiers, whitespace, number and string edge cases, regexp tokens, arrays, calls, access, precedence, associativity, UTF-16 ranges, parser vocabulary, recovery trees, and first-error reporting ([`parse.test.ts:96-888`](../../packages/filter-expression/src/parse.test.ts#L96-L888)). Item Query tests should consume the public parse result. They should not copy Lezer node-layout assertions.

### 2. Pure evaluator vectors

Create data-driven cases under `packages/item-query/src/test-corpus/`. Each case contains:

```ts
{
  id: "null.relational.missing",
  expression: "knownMissing > 1",
  environment: { knownMissing: null },
  clock: "2020-01-08T00:00:00Z",
  timeZone: "UTC",
  expected: { value: null }
}
```

Use stable case IDs and JSON-compatible expected values. For date and duration values, compare a semantic tagged representation rather than private classes. Store errors as public code, UTF-16 location, and recovery-hint category. This keeps AST nodes, evaluator classes, and registry layout outside the corpus, as required by the deep-module boundary ([ADR 0066:3-7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L3-L7)).

### 3. Deterministic SQLite scenario

Seed a small in-memory SQLite database with the shared `createFixtureSchema` helper. That helper already centralizes the Zotero table subset and lets each consumer insert only its required rows ([`test-utils.ts:8-18`](../../packages/db/src/test-utils.ts#L8-L18), [`test-utils.ts:20-180`](../../packages/db/src/test-utils.ts#L20-L180)). Put the Item Query seed beside the corpus, with symbolic public Item keys and comments that name the behavior each row supports.

The seed needs approximately 12-20 Items across one personal and one group Library. Include top-level, deleted, Attachment, Annotation, and Child Note rows; full, partial, text, invalid, and missing dates; alias variants; custom-name hazards; both creator modes; Tag and Collection variants; live and deleted Attachments; and tie-heavy scalar values. Assert the fixed universe through public Indexed Keys, not local integer Item IDs. Current database tests prove that Items exclude deleted and child types and that group identities use the group suffix ([`items.test.ts:44-89`](../../packages/db/src/queries/items.test.ts#L44-L89), [`items.test.ts:167-187`](../../packages/db/src/queries/items.test.ts#L167-L187)).

### 4. Public query expectations

Represent each integration case as a public normalized query and an expected public result:

```ts
{
  id: "order.nulls-last.indexed-key-tail",
  query: {
    filter: "volume != null",
    fields: ["title", "volume", "date.year", "custom[\"review.status\"]"],
    sort: [{ field: "volume", direction: "asc" }],
    limit: 3
  },
  expected: {
    indexedKeys: ["AAA00001", "BBB00002", "CCC00003g17"],
    values: [/* flat Projection Path maps */],
    returnedCount: 3,
    truncated: true
  }
}
```

Compare the normalized query, Indexed Keys, every requested Projection Path, value serialization, order, `returnedCount`, `truncated`, and public errors. These are the successful and invalid-result surfaces defined by the Item Query ADRs ([ADR 0064:13-15](../adr/0064-item-query-has-a-field-oriented-contract.md#L13-L15), [ADR 0066:7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L7)).

### 5. Differential planner harness

Run every valid integration case in at least two internal test modes:

1. full universe, full hydration, authoritative evaluator, in-memory order;
2. the production planner with SQL candidate and order optimization enabled.

Assert equality of the complete public result. Add planner-specific tests only for independent safety properties: each candidate set contains every authoritative match; an SQL-final order equals the public comparator including the Indexed Key tail; limit early termination returns the prefix of an unlimited result and computes `truncated` correctly. The package can expose a test-only planner control without making it a public `queryItems` option. SQL ordering remains an optimization, and scalar fields can sort in memory ([ADR 0066:7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L7)).

### 6. Generated combinations

Use deterministic table generation or property tests over the committed seed for:

- every comparison operator crossed with null and partial-date precision;
- expression-level and group-level negation around exact, inexact, and untranslatable SQL candidates;
- every supported scalar sort direction crossed with null ties and limit boundaries;
- every custom-name escaping form;
- Unicode case-fold and SQL `LIKE` metacharacter pairs.

Record the random seed on failure and promote every discovered failure to a named fixed case. This extends the historical hand-written parity matrix without binding the oracle to a specific planner ([`query.fixture.test.ts@71362fa0:517-680`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L517-L680)).

## Corpus storage alternatives

### Recommended: TypeScript vectors plus SQL seed

This form is reviewable, diffable, deterministic, and easy to share between evaluator, query, CLI-adapter, and planner tests. It reuses the current in-memory database pattern and keeps expected behavior independent of a binary SQLite file ([`items.test.ts:21-29`](../../packages/db/src/queries/items.test.ts#L21-L29), [`test-utils.ts:8-18`](../../packages/db/src/test-utils.ts#L8-L18)).

### Alternative: checked-in SQLite fixture

A checked-in database gives high schema realism and low seed code, but row intent and changes are harder to review. Use it only for an additional schema-compatibility layer. Keep the semantic oracle in text vectors.

### Alternative: developer-local Zotero database

The old suite used this form and gained useful distribution coverage, but the path, contents, and counts were machine-specific ([`AGENTS.md@71362fa0`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/AGENTS.md), [`query.fixture.test.ts@71362fa0:1-24`](https://github.com/aidenlx/zotlit/blob/71362fa09cce268476321a0f40a0595ee29c73de/packages/bases-query/src/query.fixture.test.ts#L1-L24)). Keep this as an optional performance and exploratory suite. Use the committed corpus for correctness and CI.

## Acceptance rule

The corpus is complete enough for the first Item Query implementation when:

1. every adopted proof-of-concept behavior above has a named pure or integration case;
2. every replacement behavior has a regression case that would fail under the old behavior;
3. the required adversarial cases pass against the full evaluator;
4. the production planner returns the same complete public result as the full evaluator for every valid case;
5. every invalid case fails before database execution with the specified public error shape;
6. no assertion names an old AST node, evaluator class, SQL fragment, candidate count, view structure, preload, memo, or chunk size.

This rule follows the settled boundary: the evaluator owns result correctness, SQL supplies optimization, and the public module hides its compilation and planning structure ([ADR 0063:5](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md#L5), [ADR 0066:3-7](../adr/0066-item-query-is-a-deep-module-with-two-operations.md#L3-L7)).
