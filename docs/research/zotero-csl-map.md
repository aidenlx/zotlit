# Zotero item -> CSL-JSON: upstream implementation and test map

Reference map for checking `packages/db/src/lib/zt-csl-item.ts` (`itemToCsl`) against Zotero.

## Checkout pinned

| | |
|---|---|
| Repo | `/Users/aidenlx/repo/zotlit-repo/zotero` |
| HEAD | `451d96a8240bbb607a220f949673d6bc704bb58d` (2026-05-06) |
| `version` | `9.0.3.SOURCE` |
| `chrome/content/zotero/xpcom/utilities` submodule | `1dd38e27edf81e9d9c4161c957b7efb7f5681ac3` |
| `resource/schema/global` submodule | `62e983a2e575fe9b9a3677ad7c9772080b67a1e4`, schema `version: 42` |

Two copies of `utilities_item.js` exist. The authority is
`chrome/content/zotero/xpcom/utilities/utilities_item.js` (loaded via
`chrome/content/zotero/zotero.mjs:41-47`). The copy under
`chrome/content/zotero/xpcom/translate/modules/utilities/` is a stale vendored
fork used only in the translator sandbox — it lacks the `event-place` special
case and the `radioBroadcast`/`tvBroadcast` disambiguation. Do not read it as
the authority.

Both the utilities SHA and the schema version match what ZotLit vendors, so the
`@see` links in `zt-csl-item.ts` cite the same revision Zotero 9.0.3 ships.

## Implementation map

| Symbol | Location | Role |
|---|---|---|
| `itemToCSLJSON` | `xpcom/utilities/utilities_item.js:51-239` | forward mapper, entry point |
| `itemFromCSLJSON` | `utilities_item.js:246-447` | inverse mapper |
| `extraToCSL` | `utilities_item.js:661-770` | Extra cheater-syntax normalization; called at `:125` |
| `parseParticles` | `utilities_item.js:500-613` | name particle splitting; called at `:172` |
| `noteToTitle` | `utilities_item.js:623-654` | pseudo-title for standalone notes; called at `:234` |
| `itemToExportFormat` | `xpcom/utilities_internal.js:863-1003` | live Item -> plain export object |
| `CSL_*_MAPPINGS` (app) | `xpcom/schema.js:623-664` `_loadGlobalSchema()` | builds all four tables from the bundled schema's `csl` section |
| `CSL_*_MAPPINGS` (standalone) | `xpcom/utilities/schema.js:34-58` | same construction, duplicated for non-app contexts |
| `strToDate` | `xpcom/utilities/date.js:272-484` | date-string parser every date field passes through |
| `getFieldIDFromTypeAndBase` | `xpcom/data/itemFields.js:273-290` | base -> type-specific field resolution; called at `:110` and `:189` |
| `getPrimaryIDForType` | `xpcom/data/cachedTypes.js:325-336` | primary creator type, for the `author` promotion at `:140,146-148` |

Mapping tables are derived at runtime from schema sections, not hand-written:
`csl.types`, `csl.fields.text`, `csl.fields.date`, `csl.names` — the same four
sections `packages/zotero-types/scripts/generate-csl.ts` reads.

## Date behaviour (verified by executing `strToDate` against the checkout)

| Input | `strToDate` | `itemToCSLJSON` emits |
|---|---|---|
| `2013-01-00 January 2013` | `{year:'2013', month:0, day:0, part:'January 2013'}` | `{"date-parts":[[2013,1]]}` — day 0 is falsy so dropped; `part` discarded because month is defined |
| `2024-03-01` | `{year:'2024', month:2, day:1}` | `{"date-parts":[[2024,3,1]]}` |
| `2024-03-01 12:30:00` | `{year:'2024', month:2, day:1, part:'12:30:00'}` | `{"date-parts":[[2024,3,1]]}` |
| `circa 1999` | `{year:'1999', part:'circa'}` | `{"date-parts":[[1999]], season:"circa"}` |
| `in press` | `{part:'in press'}`, no year | `{"literal":"in press"}` — literal is the **raw field string**, not `part` |
| `2015-02-30` | `{year:2015, month:1, day:30}` | `{"date-parts":[[2015,2,30]]}` — no calendar validation, only `month<=12`/`day<=31` (`date.js:349`) |

`season` is set only when `month === undefined` (`utilities_item.js:222`).
`accessDate` is shifted UTC -> local *before* `strToDate` (`:196-205`).

### Consequences for `itemToCsl`

- `2024-03-01` parsing confirms the bare-SQL-date defect fixed in `381f3d5d` was real: Zotero reads it as a full date.
- The `in press` literal difference (`"in press"` vs Zotero's `"0000-00-00 in press"`) is real and documented.
- `circa 1999` -> `season: "circa"`; match.
- `2015-02-30` -> we degrade to year-month; documented.
- `2013-01-00 January 2013` -> both sides emit `[[2013,1]]`. Match.

## Test map

| Test file | Runner | Coverage |
|---|---|---|
| `xpcom/utilities/test/tests/utilities_itemTest.js` | Node + Mocha, `test/runtests.sh`, no DB or app | The main suite. `itemFromCSLJSON` block `:2-105`; `itemToCSLJSON` block `:107-273`: standalone note `:136-143`, standalone attachment `:144-155`, unknown type throws `:156-162`, particle parsing 6 cases `:164-241`, accessDate UTC shift `:243-264`, `event-place` for presentation `:266-272` |
| `test/tests/utilitiesSubmoduleTest.js` | Full built app | Shallow smoke test only `:1-33`; asserts deep-equality between the two call forms, no field-level assertions |
| `test/tests/citeTest.js` | Full built app | `#extraToCSL()` `:46-93` — case/hyphen normalization, uppercase DOI, Zotero-name -> CSL-name |
| `test/tests/dateTest.js` | Full built app | `#strToDate()` `:166-301` — month names, year forms, century rollover. Does **not** cover multipart-with-text, `circa`, `in press`, or invalid calendar days |
| `bibliographyTest.js`, `quickCopyTest.js`, `citationDialogTest.js`, `styleTest.js` | Full built app | Exercise `itemToCSLJSON` indirectly through `Zotero.Cite.System.retrieveItem` (`cite.js:661`); assert rendered strings, not intermediate CSL-JSON |

## Coverage checklist

| Behaviour | Upstream test status |
|---|---|
| Item type mapping, all 34 types | pinned — round-trip fixture |
| Shared CSL types (broadcast / motion_picture / personal_communication) | pinned — all 8 Zotero types in the fixture |
| Text-field candidate fallback | **no test found** |
| Base vs type-specific field resolution | no direct test; only the inverse `getBaseIDFromTypeAndField` is tested (`itemFieldsTest.js:4-47`) |
| `event-place` / `publisher-place` special case | pinned — `:80-104` (import), `:266-272` (export) |
| ISBN truncation to first ISBN | **no test found** (`cleanISBN` is a different code path) |
| Enclosing-quote stripping | **no test found** |
| `shortTitle` vs `title-short` write rule | pinned — `:26-39` |
| Primary-creator-type -> `author` promotion | pinned indirectly via fixture |
| Unmapped non-primary creator types dropped | **no test found** — the fixture is seeded *from* CSL-JSON so it cannot contain one |
| Name particles, quoted family names | pinned — `:164-241`, 6 cases |
| `issued` / `accessed` | pinned via fixture + UTC-shift test |
| `submitted` / `original-date` | thin — `submitted` only via `patent`; `original-date` literal form via `book`, `bookSection`, `patent` |
| `date-parts` vs `literal` split | pinned — fixture mixes both |
| `season` | **no test found** |
| `accessDate` UTC -> local | pinned — `:243-264` |
| `extraToCSL` transform itself | pinned — `citeTest.js:46-93` |
| `extraToCSL` *wired into* `itemToCSLJSON` | weak — fixture's `note` value carries no cheater syntax, so broken wiring would pass |

## Fixtures

| Path | Coverage |
|---|---|
| `xpcom/utilities/test/data/citeProcJSExport.json` | **The** golden fixture — one full CSL-JSON object per Zotero item type, 34 entries covering nearly every text/name/date field plus primary-creator promotion. The primary case-by-case comparison target for `itemToCsl`. |
| `xpcom/utilities/test/data/journalArticle.json` | native export format; used by the skipped round-trip test and the unknown-type-throws test |
| `test/tests/data/journalArticle.js` | native format, DB-populatable; used by the smoke test |
| `test/tests/data/allTypesAndFields.js` | generated by `test/content/support.js:869-948`; native-item counterpart whose field conventions match the CSL fixture |

## Follow-up worth considering

`citeProcJSExport.json` is a ready-made differential-test corpus: for each of its
34 entries, build the equivalent `Item` row and assert `itemToCsl` produces the
same CSL-JSON. That would cover the areas upstream itself leaves untested
(candidate fallback, ISBN truncation, quote stripping) far better than the
hand-written fixtures currently in `zt-csl-item.test.ts`.
