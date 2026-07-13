Status: ready-for-agent

# `extra-parsing` — best-effort structured access to Zotero's Extra field

## Problem Statement

Zotero's **Extra** field is a free-text box where users pack structured information as `key: value` lines — Better BibTeX `tex.*` fields (e.g. `tex.mendeley-tags: reliability,transport economics`), CSL variables, citation keys, DOIs — often mixed with plain prose. ZotLit currently exposes this field to templates only as one opaque raw string (`zt.extra`). A template author who wants a single value out of it has no choice but to hand-roll string splitting inside a Liquid or Eta template, which is awkward, error-prone, and effectively impossible in Liquid. The structure the user deliberately encoded in Zotero is invisible to the plugin.

## Solution

Parse the Extra field best-effort into structured key-value data **while preserving the verbatim raw string**, and surface it on `zt.extra`. Each `key: value` (or `key = value`) line becomes an **Extra Pair**; everything — pairs and non-pair prose alike — is also retained as ordered **Extra Lines**, and the original text stays available as `zt.extra.raw`. A template author can then read `zt.extra.fields.doi` directly, iterate `zt.extra.lines`, or still print the whole field. The parse is deliberately generic: it understands the `key: value` shape, not Zotero/CSL/BBT field semantics, so arbitrary freeform content degrades gracefully rather than being dropped.

## User Stories

1. As a template author, I want to read a single Extra value by key (`zt.extra.fields["tex.mendeley-tags"]`), so that I can surface Mendeley tags in my literature note without string-munging.
2. As a Liquid template author, I want key lookup to work with plain property/bracket access and standard filters (`| first`, `| join`), so that I can use Extra data even though Liquid cannot call methods.
3. As an Eta template author, I want the same parsed object to be plain JS data, so that I can index `fields` and iterate `lines` with ordinary JavaScript.
4. As a template author, I want `zt.extra.raw` to hold the exact original field text, so that I can still print the whole field verbatim or do my own parsing when the structured view doesn't fit.
5. As a template author with an existing template that prints `{{ zt.extra }}`, I want it to keep printing the raw field text, so that upgrading does not silently turn my note into `[object Object]`.
6. As a user with prose interleaved between key-value lines, I want the non-pair lines preserved in order, so that nothing I typed into Extra is lost.
7. As a user who repeats a key (e.g. two `tex.mendeley-tags` lines), I want the first occurrence available as the default value and every occurrence retained, so that I don't silently lose data.
8. As a user who scans for all values of a repeated key, I want to iterate `zt.extra.lines` and match on `key`, so that duplicate values are recoverable.
9. As a user of the Template Data Explorer, I want `zt.extra` to expand into its `raw`, `fields`, and `lines` children, so that I can browse the parsed structure and copy paste-correct template paths.
10. As a user of the Template Data Explorer, I want the collapsed `extra` row to show a one-line preview of the raw text, so that I can recognize the field before expanding it.
11. As a user with keys containing dots, spaces, or hyphens (`tex.mendeley-tags`, `Citation Key`, `Original Date`), I want those parsed as valid keys, so that real-world Extra conventions are captured.
12. As a user whose values contain colons (`URL: https://x/a:b`, `time: 10:30`), I want only the first delimiter to split the line, so that the value survives intact.
13. As a user who writes `key = value` (Better BibTeX raw-LaTeX form), I want `=` accepted as a delimiter alongside `:`, so that those lines parse too.
14. As a user on Windows whose Extra field has CRLF line endings, I want lines split correctly, so that parsing behaves the same across platforms.
15. As a user who leaves blank lines or trailing whitespace, I want the parser to tolerate them without producing junk pairs, so that the structured view stays clean.
16. As a developer consuming `@zotlit/db`, I want a single pure `parseItemExtra` export mirroring `parseItemDate` / `parseItemLanguage`, so that the parser is reusable and testable at the package boundary.
17. As a developer, I want the CSL/citation output path to keep receiving the Extra field as a raw string, so that CSL-JSON `note` compliance is unaffected by this feature.

## Implementation Decisions

### Scope: generic best-effort key-value splitter

The parser splits lines into key/value on a delimiter and preserves keys verbatim. It has **no** Zotero/CSL/BBT field knowledge — it does not map keys to CSL variables, item types, or creator types, and does not special-case `tex.` / `bibtex.` prefixes. This is intentionally narrower than Zotero's own `Zotero.Utilities.Internal.extractExtraFields`, and by design it parses BBT `tex.*` lines that Zotero's built-in parser rejects.

### `parseItemExtra` — new pure helper in `@zotlit/db`

A pure `parseItemExtra(raw: string | null | undefined): ItemExtra | null` is added to the domain-helper layer alongside `parseItemDate` and `parseItemLanguage`, and re-exported from the package entry. Returns `null` for nullish/empty/whitespace-only input, matching the sibling parsers' signature and null-handling. Takes all input as arguments, holds no state, does no I/O.

### `ItemExtra` shape — plain data (see ADR 0006)

The result is a plain object (not a class), so it is directly usable in Liquid, Eta, JS, and the Template Data Explorer:

```ts
interface ItemExtra {
  readonly raw: string;                              // verbatim original, full round-trip
  readonly fields: Readonly<Record<string, string>>; // first value per key — the common-case lookup
  readonly lines: readonly ExtraLine[];              // every source row, in order
}

type ExtraLine =
  | { readonly raw: string; readonly key: string; readonly value: string } // parsed pair
  | { readonly raw: string; readonly key: null };                          // text / blank / non-pair
```

- `lines` is the source of truth; `fields` is the derived first-wins lookup over the pair-rows.
- A non-enumerable `toString()` returning `raw` is attached via the existing `defineToString` helper (same mechanism as `ItemDate`), so bare template interpolation prints the raw text and the explorer shows a raw preview.
- Immutable: no mutators, and no re-serializer — `toString` returns the *stored* raw, never a reconstruction from pairs.
- `URLSearchParams` semantics are retained as data rather than methods: `get(k)` ≡ `fields[k]`, `getAll(k)` ≡ scan `lines`, `has(k)` ≡ `k in fields`. No dedicated `size`.

### Parsing rules

- **Line splitting:** split `raw` on `/\r?\n/` (tolerate Windows CRLF; Zotero itself splits on bare `\n`). Blank lines are preserved as text rows.
- **Key-value rule:** a line is a pair when it matches, on the **first** `:` or `=`, a key that starts with a letter and otherwise contains only letters, digits, spaces, dots, hyphens, or underscores (shape: `^([A-Za-z][\w .-]*?)\s*[:=]\s*(.+)$`). This admits real keys (`tex.mendeley-tags`, `Citation Key`, `Original Date`) while rejecting URLs and most prose before the delimiter. Lines that don't match become text rows.
- **First delimiter only:** the value keeps any later `:` / `=` characters (`URL: https://x/a:b` → value `https://x/a:b`).
- **Trimming:** key and value are trimmed; the row's `raw` stays verbatim (untrimmed).
- **Empty values:** a line whose value trims to empty is classified as a text row (`key: null`), not a pair — mirroring Zotero skipping empty values, keeping `fields` clean.
- **Repeats:** first occurrence wins in `fields`; all occurrences remain in `lines`. Keys are case-sensitive and never normalized.

### Template wiring

`itemToTemplateBaseData` surfaces `zt.extra` **parsed**, mirroring how `date` is already surfaced via `parseItemDate`. `TemplateItemData.extra` changes type from `string | null` to `ItemExtra | null`. No change is needed in the Template Data Explorer: it renders plain objects/arrays generically and already reads own `toString` for previews.

### Untouched paths

The CSL context mapper continues to pass Extra through as a raw `string | null` (it feeds the CSL `note` variable). No mutation/write-back of the Extra field is introduced anywhere.

## Testing Decisions

- **What makes a good test:** exercise `parseItemExtra` through its public input→output contract only — feed raw strings, assert on `raw`, `fields`, and `lines` (and that `String(result)` returns `raw`). Do not assert on internal helpers or regex internals. Cover the decision-bearing cases: `tex.*` and dotted/spaced keys; values containing colons; `=` delimiter; first-wins on repeats with all occurrences retained in `lines`; empty-value → text row; blank lines and CRLF; interleaved prose preserved in order; `null`/empty/whitespace input → `null`.
- **Module under test:** `parseItemExtra` in `@zotlit/db`. This is the single seam; the template wiring is a type/call change covered by typecheck and the existing explorer tests.
- **Prior art:** `zt-date.test.ts` and `zt-lang.test.ts` in `@zotlit/db` — same pure-parser-returns-tagged-shape pattern, same table-driven style.

## Out of Scope

- Any CSL / Zotero-field / creator-type mapping (`Type:`, `Issued:`, author lines). Keys stay verbatim; no semantic resolution.
- BBT-specific interpretation: `=`-means-raw-LaTeX, `tex.`/`bibtex.`/`biblatex.` prefix handling, case-based case-protection. `=` is accepted only as a generic delimiter.
- The deprecated citeproc "cheater" `{:key: value}` syntax.
- Splitting comma-joined values (`reliability,transport economics`) into arrays — values stay whole strings; consumers split if they wish.
- Mutation / re-serialization / writing the Extra field back to Zotero (belongs to the Zotero companion, not `@zotlit/db`).
- A dedicated non-pair-lines collection or `size` accessor — `raw` and `lines` cover both.
- Changing the CSL `note` output.

## Further Notes

- Grounded in upstream `Zotero.Utilities.Internal.extractExtraFields` (9.0.3) and the Better BibTeX Extra-fields docs; ZotLit deliberately diverges toward a permissive generic splitter (Zotero's key charset excludes `.`, so it would reject the motivating `tex.mendeley-tags` example).
- Domain terms **Extra**, **Extra Pair**, and **Extra Line** are recorded in `packages/db/CONTEXT.md`.
- The plain-data-over-`URLSearchParams`-methods decision is recorded in ADR 0006.
