# Stage 3.1 — Search engine swap: MiniSearch + Intl.Segmenter

Delta on top of [`STAGE3_CITATION_SUGGEST.md`](./STAGE3_CITATION_SUGGEST.md).
This spec **supersedes** §2 ("Engine", "Scoring", "Citekey field"), §5
(`services/item-lookup/`), §9.2 (service tests), §10 ("CJK ranking quality",
"Future engine swap") of that document; everything else (the `packages/db`
query layer in §4, the editor-suggest / quick-switch wiring in §6–§7, the
i18n keys in §8, and the migration amendments in §11) stays untouched.

## 1. What this stage changes

| Axis             | Stage 3 (current)                                                                  | Stage 3.1 (this spec)                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine           | Obsidian `prepareFuzzySearch` / `prepareSimpleSearch` + `pickSearchFn`             | `minisearch` (npm), in-memory index per library                                                                                                                                                                                                                                                                            |
| Scoring shape    | Single-best-field; one winning field per hit                                       | Multi-field BM25 with AND combine across tokens; per-field boosts                                                                                                                                                                                                                                                          |
| Tokenization     | Whatever Obsidian's native does                                                    | `Intl.Segmenter({granularity:"word"})` + hyphen guard + optional `cm-chs-patch` enhancement for CJK runs                                                                                                                                                                                                                   |
| Normalization    | Implicit in Obsidian's API                                                         | Lowercase + NFD diacritics strip in `processTerm`, identically for index and query                                                                                                                                                                                                                                         |
| Citekey rank     | Searchable, boost `0.05` (tied with creators)                                      | Searchable but heavily down-weighted (boost `0.1` vs title `2.5`) so dup-overlap with author+date doesn't bubble worse docs up                                                                                                                                                                                             |
| `matchedField`   | Reported on every hit; drives a per-row icon                                       | Dropped — multi-field hits make a single icon meaningless                                                                                                                                                                                                                                                                  |
| Highlights       | Hand-rolled `createSpan` loop over `[start,end]` ranges                            | `renderMatches(el, text, ranges)` from `obsidian` API; ranges computed via omnisearch-style regex over `hit.terms` (the indexed terms that matched, so prefix and fuzzy expansions still highlight). Title-only, wrapped in a `renderTruncatedHighlight` window so a deep match stays inside the row's CSS-ellipsis budget |
| Index lifecycle  | Cached `Item[]`; ranker re-runs per call                                           | Lazy build + background prewarm: `MiniSearch` instance cached alongside `Item[]`; invalidate drops the instance and re-queues build                                                                                                                                                                                        |
| Recency in score | n/a (only sorts empty-query slice)                                                 | Mild multiplicative bonus `1 + 0.1 · exp(-daysElapsed / 30)`; reorders only when scores tie. Empty-query slice still pure `dateModified DESC`                                                                                                                                                                              |
| Tests / mocks    | Obsidian mock ships hand-rolled `prepareFuzzySearch` / `prepareSimpleSearch` shims | Mock shims **deleted**; tests use real `MiniSearch`. Tokenizer covered by its own unit tests                                                                                                                                                                                                                               |

## 2. Why this swap

The Stage 3 spec deliberately rejected an index-build engine because the
230 ms cache load was already the dominant cost. Three things make the swap
right now:

1. **Cross-field AND queries.** The example `[@senior septa 2015]` only
   resolves when all three tokens are required to land somewhere — `senior`
   in title, `septa` in creators, `2015` in date. Single-best-field cannot
   express that; it picks one winning field per item and ignores the
   others. MiniSearch's multi-field, AND-combined search expresses it
   natively.
2. **Citekey ranking control.** Citekeys often inline author+year
   (`septa2015`). With single-best-field's hard winner per item, a citekey
   accidentally outranks a strict title+creators+date match. With explicit
   per-field boosts and AND-combined scoring, we can keep citekey
   searchable for the `[@septa2015]`-style direct lookup while making it
   negligible against author+date.
3. **Tokenization quality across scripts.** Obsidian's native ranker is a
   black box; Intl.Segmenter gives us locale-aware word boundaries for
   Latin, CJK, RTL, and mixed text, with a single tokenizer used identically
   for index and query.

The bundle cost (~5 KB gzipped) is acceptable. The added build cost (one
`MiniSearch.addAll` pass per library load, in the same `~100–200 ms` ballpark
as the DB query at 24k items) is hidden behind the **lazy + prewarm**
lifecycle: prewarm fires when `db.changed` invalidates, so the first
keystroke usually finds a warm index.

## 3. Module layout (delta)

```
apps/obsidian/src/services/item-lookup/
  service.ts                        # ItemLookup class — unchanged public API; cache now holds the index
  engine.ts                         # MiniSearch wrapper: buildIndex / search / SearchHit shape
  tokenizer.ts                      # Intl.Segmenter + hyphen guard + cm-chs-patch lookup
  render-hit.ts                     # renderSuggestion using renderMatches
  service.test.ts                   # cache lifecycle (unchanged shape)
  engine.test.ts                    # engine + tokenizer; uses real MiniSearch
  tokenizer.test.ts                 # tokenizer alone, synthetic strings
```

`search.ts` is **removed**; its responsibilities split into `engine.ts`
(MiniSearch wrapper + scoring) and `tokenizer.ts` (segmentation). The
`SearchHit` type continues to be exported from this folder so call sites
in `views/citation-suggest/` and `views/quick-switch/` don't change.

## 4. `tokenizer.ts`

Pure functions — no Obsidian app dependency. The cm-chs-patch enhancement
is passed in as a parameter so the tokenizer remains unit-testable.

```ts
export interface ChsSegmenter {
  cut(word: string, opts: { search: boolean }): string[];
}

export interface TokenizerOptions {
  /** Pre-constructed Intl.Segmenter (granularity: "word"). */
  intl: Intl.Segmenter;
  /** Optional cm-chs-patch instance for CJK runs; null when plugin absent. */
  chsSegmenter?: ChsSegmenter | null;
}

/** Index- and query-time tokenizer. Used identically for both. */
export function tokenize(text: string, opts: TokenizerOptions): string[];

/** MiniSearch processTerm: lowercase + Polish ł fold + NFD diacritics strip. */
export function normalize(term: string): string;
```

### 4.1 `tokenize` algorithm

1. `Intl.Segmenter` walks `text` at `granularity: "word"`, yielding segments
   each tagged `isWordLike`. Discard non-wordlike segments.
2. For each wordlike segment, if it contains any character in
   `/[一-龥]/u` and a `ChsSegmenter` is available, replace with
   `chs.cut(segment, { search: true })`. Otherwise keep as one token.
3. Apply a hyphen-guard pass: `token.split("-").filter(Boolean)`. ICU
   usually splits on `-` already, but locales vary; this is cheap insurance
   for `García-López`, `n-gram`, `cross-sectional`.
4. Return the flat array. No deduplication; MiniSearch handles dedupe
   internally on its inverted index.

### 4.2 `normalize` algorithm

```ts
export function normalize(term: string): string {
  return (
    term
      .toLowerCase()
      // NFD does not decompose Polish ł, so fold it explicitly first.
      .replaceAll("ł", "l")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
  );
}
```

Same function wires into MiniSearch's `processTerm` and is called on each
query token before it hits the index. `garcia` matches `García`,
`lukasiewicz` matches `Łukasiewicz`. The explicit `ł → l` step is needed
because `Ł`/`ł` are precomposed Latin letters with stroke; NFD leaves them
intact and the diacritic strip then has nothing to remove. No
configurability — defer to a future setting if a user complains.

### 4.3 cm-chs-patch discovery

```ts
// engine.ts (not tokenizer.ts — keeps the tokenizer app-free)
export function getChsSegmenter(
  app: App | null | undefined,
): ChsSegmenter | null {
  const plugin = app?.plugins?.plugins?.["cm-chs-patch"];
  if (!plugin || typeof plugin !== "object") return null;
  const cut = (plugin as { cut?: unknown }).cut;
  return typeof cut === "function" ? (plugin as ChsSegmenter) : null;
}
```

`App.plugins.plugins` is a private surface; it is declared in
`apps/obsidian/src/typings/obsidian-ex.d.ts` (`Record<string, unknown>`) so
the engine can read it without `any`-casting.

`services/build.ts` wires `getChsSegmenter: () => getChsSegmenter(plugin.app)`
into the `ItemLookup` constructor; the service calls it once per rebuild and
forwards the result through `TokenizerOptions.chsSegmenter`. No event
subscription — if the user installs `cm-chs-patch` after the index is
built, the next invalidation (any `db.changed` or library switch) picks it
up. Acceptable.

## 5. `engine.ts`

```ts
import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import type { App, SearchMatches } from "obsidian";
import type { Creator, Item } from "@zotlit/db";

export interface SearchHit {
  item: Item;
  score: number;
  /** Character ranges into `item.title`, ready for renderMatches. */
  matches: SearchMatches;
}

export interface SearchIndex {
  /** Library this index was built for. */
  libraryID: number;
  /** Items in `dateModified DESC` order; used for the empty-query slice. */
  items: readonly Item[];
  /** O(1) hydration of MiniSearch hit IDs → Items. */
  byId: ReadonlyMap<number, Item>;
  mini: MiniSearch<IndexedItem>;
}

/** Single options bag carried by `searchIndex` — keeps the call site flat. */
export interface SearchIndexOptions {
  tokenizer: TokenizerOptions;
  limit: number;
}

interface IndexedItem {
  id: number;
  title: string;
  creators: string;
  date: string;
  citekey: string;
}
```

### 5.1 `buildIndex`

```ts
export function buildIndex(
  items: readonly Item[],
  tokenizerOpts: TokenizerOptions,
  libraryID: number,
): SearchIndex;
```

Configures MiniSearch with:

```ts
new MiniSearch<IndexedItem>({
  idField: "id",
  fields: ["title", "creators", "date", "citekey"],
  storeFields: [], // we hydrate via byId; nothing else needs to live in the index
  tokenize: (text) => tokenize(text, tokenizerOpts),
  processTerm: (term) => {
    const t = normalize(term);
    return t.length > 0 ? t : null;
  },
});
```

Then `mini.addAll(indexed)` where `toIndexed` flattens creators
(`[lastName, firstName].filter(Boolean).join(" ")` per creator, joined by
`"; "` across creators) and coerces nullish fields to `""`. `byId` is built
in the same pass over `items`, keyed by `item.itemID`.

### 5.2 `searchIndex`

```ts
export function searchIndex(
  index: SearchIndex,
  query: string,
  opts: SearchIndexOptions,
): SearchHit[];
```

1. `tokenize(query, opts.tokenizer)` → array of tokens.
2. If zero tokens (whitespace-only query), return `[]`. (Empty-query path is
   handled in `service.ts` before reaching the engine.)
3. Capture `nowMs = Date.now()` once for the whole call so the recency
   multiplier is stable across hits.
4. Run:
   ```ts
   index.mini.search(tokens.join(" "), {
     combineWith: "AND",
     prefix: true,
     fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2),
     boost: {
       title: 2.5,
       creators: 2,
       date: 1,
       citekey: 0.1,
     },
     // Tokens are already segmented by our Intl.Segmenter pass; the inner
     // tokenize just re-splits on the space we joined with.
     tokenize: (text) => text.split(" ").filter((part) => part.length > 0),
     processTerm: normalize,
   });
   ```
   MiniSearch's `search()` accepts a string, not a token array, so we
   re-join the segmented tokens with a single space and give the inner
   tokenizer a trivial space-split. Our `Intl.Segmenter` pass has already
   produced the segmentation we want; the inner pass is just plumbing.
5. For each MiniSearch hit hydrate the `Item` from `index.byId` (skip any
   miss), compute the adjusted score as `hit.score *
recencyMultiplier(item, nowMs)`, and compute highlight ranges via
   `highlightRanges(hit, item.title ?? "")`.
6. Re-sort the resulting hits by adjusted score (MiniSearch returns them
   sorted by raw score; the recency multiplier can reorder near-ties), then
   `slice(0, opts.limit)`.

#### Recency multiplier

```ts
const RECENCY_MAX_BOOST = 0.1;
const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function recencyMultiplier(item: Item, nowMs: number): number {
  const daysElapsed = Math.max(
    0,
    (nowMs - item.dateModified.epochMilliseconds) / MS_PER_DAY,
  );
  return (
    1 + RECENCY_MAX_BOOST * Math.exp(-daysElapsed / RECENCY_HALF_LIFE_DAYS)
  );
}
```

- Multiplier range is `[1.0, 1.1]`, so it can only reorder near-ties — a
  strict-relevance win still outranks a "just opened last night" hit.
- `dateModified` is a `Temporal.Instant` carried on every `Item` (added in
  `queries/items.ts`); accessing `.epochMilliseconds` is allocation-free.
- Clamped at 0 for safety against clock skew on items dated in the future.
- The empty-query path bypasses this multiplier entirely — it returns
  `items.slice(0, limit)` which is already `dateModified DESC`.

### 5.3 `highlightRanges`

Omnisearch-pattern offset computation, fed to `renderMatches` later.
Highlight terms come from `hit.terms` — the indexed terms that actually
matched after prefix + fuzzy expansion. The match runs in **normalized
space** and offsets are mapped back into the original title via
`normalizeWithIndexMap`. The whole pass runs only on the
post-score-sort-and-slice top-N hits (see §5.2), not on every match.

```ts
function highlightRanges(hit: MiniSearchResult, title: string): SearchMatches {
  if (!title || hit.terms.length === 0) return [];

  const escaped = [...hit.terms]
    .sort((a, b) => b.length - a.length)
    .map(RegExp.escape);
  const re = new RegExp(`\\b(${escaped.join("|")})`, "giu");

  const { normalized, indexMap } = normalizeWithIndexMap(title);
  const ranges: SearchMatches = [];
  for (const match of normalized.matchAll(re)) {
    ranges.push([
      indexMap[match.index]!,
      indexMap[match.index + match[0].length]!,
    ]);
  }
  return ranges;
}
```

Two regressions are fixed by this shape:

- **Diacritic folding.** Typing `util` lands on a title containing the
  precomposed `útil`. The index stores the normalized `util` (NFD strip
  removes the combining acute), so MiniSearch matches; running the regex
  against the raw title would find nothing because `ú ≠ u`. Matching in
  normalized space and translating offsets through the index map produces
  the correct range over the original `útil` characters.
- **Fuzzy expansion.** Typing `utilz` fuzzy-matches indexed `util`. The
  user-typed token `utilz` never appears in the title, so highlighting
  from `hit.queryTerms` would silently drop the span. `hit.terms` returns
  the indexed terms that matched (`["util"]` in this case), and those
  always appear in the normalized title.

Switching to `hit.terms` is a behavior change for the prefix case too:
typing `sept` matching indexed `septa` now highlights the full word
`septa` (rather than just the `sept` prefix). For a suggester surface,
showing the actual matched word reads more naturally than only echoing
what the user typed.

- **`hit.queryTerms` over `hit.terms`.** After fuzzy/prefix expansion,
  `hit.terms` can include matched-but-not-typed words (e.g. typing `sept`
  expands to `septa`, `september`); highlighting those is jarring because
  the user didn't type them. `hit.queryTerms` is the original query
  segmentation — exactly what the user typed. Fall back to `hit.terms`
  only if MiniSearch ever returns an empty `queryTerms`.
- `\b` left-anchored, none on the right: prefix matches still highlight
  (typing `sept` against indexed `septa` highlights `sept…` from the word
  start; we trim to the actual matched text so the user sees `sept` lit,
  not `septa`).
- `giu` flags: case-insensitive (the title is the raw cased text), unicode,
  global.
- We only highlight the `title` field. Creators / date / citekey are short,
  often appear in the meta line as a derived summary (`Last et al.`, year
  only), and bolding inside them adds noise. The dropped matched-field
  icon already removed the need to advertise which other field matched.
- **`RegExp.escape` is native.** No `escapeRegExp` helper needed; the
  staged toolchain (Node 26, evergreen V8) ships `RegExp.escape` directly.

## 6. `service.ts` deltas

The public API and cache invalidation triggers are **unchanged** from
Stage 3 §5.1. Only the cache _payload_ changes from `{libraryID, items}`
to `{libraryID, index: SearchIndex}`, and a prewarm hook is added.

### 6.1 Cache shape

```ts
interface ItemCache {
  libraryID: number;
  index: SearchIndex; // owns items, byId, MiniSearch instance
}
```

The `Item[]` lives inside `SearchIndex.items` — only one copy in memory.

### 6.2 Prewarm

After `ready` resolves (subscriptions wired), kick a fire-and-forget
`#loadIfNeeded()` so the user's first keystroke usually finds a warm
index. On every invalidation (`db.changed`, library setting change),
re-queue prewarm:

```ts
#invalidate(): void {
  this.#cache = null;
  void this.#loadIfNeeded().catch(() => {
    /* DatabaseError already swallowed inside loadLibrary */
  });
}
```

If the user opens the suggester before prewarm finishes, the in-flight
dedup path (Stage 3 §5.1) already shares the Promise. No additional
synchronization needed.

### 6.3 Search dispatch

```ts
async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
  await this.ready;
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];

  const index = await this.#loadIfNeeded();
  if (!index) return [];

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return index.items.slice(0, limit).map((item) => ({
      item,
      score: 0,
      matches: [],
    }));
  }

  return searchIndex(index, trimmed, {
    tokenizer: this.#tokenizerOpts,
    limit,
  });
}
```

`#tokenizerOpts` is rebuilt on every `#loadLibrary` call by
`#createTokenizerOpts()`: `intl` is a single `Intl.Segmenter(undefined, {
granularity: "word" })` constructed once in the field initializer, and
`chsSegmenter` is re-resolved (via the injected `getChsSegmenter` callback)
so a freshly installed `cm-chs-patch` is picked up on the next
invalidation — see §4.3.

## 7. `render-hit.ts` deltas

Drop the matched-field icon path entirely. Replace the hand-rolled
`renderMatchedText` loop with Obsidian's `renderMatches` API. The title
goes through a `renderTruncatedHighlight` helper (pattern borrowed from
[`mx-repo/apps/obsidian/src/views/media-switcher/picker.ts`](https://github.com/PKM-er/media-extended/blob/main/apps/obsidian/src/views/media-switcher/picker.ts))
so a match deep inside a long title isn't hidden by the row's CSS
ellipsis. The year regex (`\d{4}`) is authored via `arkregex`'s
`regex(...)` per repo convention.

```ts
import { renderMatches, type SearchMatches } from "obsidian";
import { regex } from "arkregex";
import type { SettingsService } from "../settings/service";
import type { SearchHit } from "./engine";

const YEAR = regex("\\d{4}");
const TITLE_MAX_CHARS_VAR = "--zt-citation-title-max-chars";
const TITLE_MAX_CHARS_FALLBACK = 60;

export function renderSuggestion(
  deps: RenderDeps,
  hit: SearchHit,
  el: HTMLElement,
): void {
  el.empty();
  el.addClass("zt-citations");

  const contentEl = el.createDiv("suggestion-content");
  const titleEl = contentEl.createDiv("suggestion-title");
  const title = hit.item.title ?? hit.item.citekey ?? hit.item.key;
  renderTruncatedHighlight(titleEl.createSpan(), title, hit.matches);
  // …creators / year / optional citekey lines unchanged…
}

function renderTruncatedHighlight(
  el: HTMLElement,
  text: string,
  matches: SearchMatches,
): void {
  const maxChars = readTitleMaxChars(el);
  if (text.length <= maxChars || matches.length === 0) {
    renderMatches(el, text.substring(0, maxChars), matches);
    if (matches.length === 0 && text.length > maxChars) el.appendText("…");
    return;
  }
  const firstMatch = matches[0]!;
  const matchLen = firstMatch[1] - firstMatch[0];
  const contextBefore = Math.floor((maxChars - matchLen) / 3);
  let windowStart = Math.max(0, firstMatch[0] - contextBefore);
  const windowEnd = Math.min(text.length, windowStart + maxChars);
  if (windowEnd === text.length) {
    windowStart = Math.max(0, windowEnd - maxChars);
  }
  if (windowStart > 0) el.appendText("…");
  renderMatches(
    el,
    text.substring(windowStart, windowEnd),
    matches,
    -windowStart,
  );
  if (windowEnd < text.length) el.appendText("…");
}

function readTitleMaxChars(el: HTMLElement): number {
  if (typeof window === "undefined") return TITLE_MAX_CHARS_FALLBACK;
  const raw = getComputedStyle(el).getPropertyValue(TITLE_MAX_CHARS_VAR).trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : TITLE_MAX_CHARS_FALLBACK;
}
```

CSS owns the width budget; JS derives the truncation window from it:

```css
.zt-citations {
  --zt-citation-title-max-chars: 60;
  /* … */
}
.zt-citations .suggestion-title {
  max-width: calc(var(--zt-citation-title-max-chars) * 1ch);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- The single source of truth is `--zt-citation-title-max-chars` on
  `.zt-citations`. CSS turns it into a `max-width` via `calc(… * 1ch)`;
  JS reads the same property via `getComputedStyle` so the truncation
  window is exactly the visible budget. Theme snippets that override the
  variable widen or narrow both at once with no JS change.
- `1ch` is the width of the `'0'` glyph at the title's font/size, so the
  numeric value reads as "approximately N characters". For variable-width
  fonts it's an estimate, but it tracks the row's actual capacity far
  better than a fixed pixel value.
- `TITLE_MAX_CHARS_FALLBACK = 60` only fires when `window` is undefined
  (Vitest in Node) or the CSS hasn't loaded yet — production reads the
  CSS value directly.

Window picking inside the helper:

- Allocate roughly `(maxChars − matchLen) / 3` chars as context _before_
  the first match, the rest after — biased toward following context but
  enough leading context that the user can see how the match attaches to
  the surrounding words.
- If the match sits near the very end of `text`, the window is shifted
  left so it fills `maxChars` instead of producing a short tail.
- `renderMatches`'s 4th-arg offset (`-windowStart`) shifts every range in
  `matches` into the substring's coordinate space so multiple matches in
  the chosen window stay highlighted, not just the first one.
- CSS ellipsis still guards the sub-`ch` edge case — `1ch` is an
  approximation, so the actual rendered width can still overflow by a few
  pixels on wide glyphs; CSS handles that gracefully.

`.suggestion-aux` / matched-field `<kbd>` block is removed; no Stage 3
i18n keys depend on it. Suggester styles live next to the view in
`apps/obsidian/src/views/citation-suggest/style.css` (imported from
`register.ts`) and target the `.zt-citations` class added by
`renderSuggestion` so both the editor-suggest and quick-switch surfaces
share the same look.

## 8. Obsidian mock cleanup

Delete from `apps/obsidian/__mocks__/obsidian.ts`:

- `prepareFuzzySearch`
- `prepareSimpleSearch`
- private helpers: `fuzzySearch`, `mergeRanges`
- the `SearchResult` type import (no longer referenced)

Keep everything else (`Notice`, `EditorSuggest`, `Plugin`, `Vault`, etc.).

`renderMatches` is **not** added to the mock. Stage 3.1 keeps Stage 3's
position from §9.3: no unit tests for editor-suggest, quick-switch modal,
or highlight rendering. The render path is exercised manually.

## 9. Tests

### 9.1 `tokenizer.test.ts`

Unit tests against `tokenize` and `normalize`, no Obsidian dependency:

- ASCII: `"Cross-sectional study"` → `["cross", "sectional", "study"]` after
  normalize.
- Latin diacritics: `"García-López"` → `["garcia", "lopez"]`.
- CJK without segmenter: `"中文检索"` → ICU best-effort (likely one or two
  segments — assert the call returns a non-empty array; don't pin ICU
  output as ICU versions drift).
- CJK with `chs` stub: inject a `ChsSegmenter` whose `cut` returns
  `["中文", "检索"]`; assert that's what `tokenize` returns for the CJK
  portion.
- Hyphen guard: pass tokens like `"a-b-c"` (constructed to dodge ICU's
  natural split) and assert split-on-hyphen output.
- Mixed: `"Smith等2020"` (CJK adjacent to ASCII) tokenizes via Intl.Segmenter
  word boundaries, CJK run further segmented.
- `normalize("Łukasiewicz") === "lukasiewicz"`.

### 9.2 `engine.test.ts`

Unit tests against `buildIndex` and `searchIndex` using real MiniSearch and
a hand-built `Item[]` fixture. Cover:

- The `[@senior septa 2015]` case: doc with title `Senior citizen transit
ID cards`, creator `SEPTA`, date `2015-01-01`, citekey `septa2015`;
  search query `senior septa 2015` returns this doc as the top hit.
- AND combine: search `senior nonexistent 2015` against the same fixture
  returns `[]` (token `nonexistent` must match somewhere).
- Citekey deprioritization: two docs — A has title/creators/date matching
  the query but citekey unrelated; B has only a citekey that decomposes to
  the query tokens. A outranks B.
- Empty-query: not exercised by the engine (the service handles it before
  the engine is called); assert `searchIndex(idx, "   ", opts, 50) === []`.
- Highlight ranges: title `"Senior citizen transit ID cards"`, query
  `senior 2015` (only `senior` matches the title): `hit.matches` is
  `[[0, 6]]` — one range covering `senior` (case-insensitive, original
  cased text preserved via the regex capture).
- Diacritic-folded highlight regression: title `"…infraestructura útil
para…"`, query `util`. The matched range, when sliced from the original
  title, must read back as `útil` (not `util` — the highlight has to
  stay over the user-visible characters).

### 9.3 `service.test.ts`

Cache-lifecycle tests from Stage 3 §9.2 carry forward unchanged in shape;
only the assertion that the cached object is "an index with N items" vs
"an array of N items" shifts. Specifically still cover:

- Lazy load + prewarm: first `search()` (or prewarm) triggers one load;
  subsequent calls hit the cached index.
- In-flight dedup: two concurrent searches share one underlying
  `loadItems` call.
- Invalidate on `db.changed`: emit, observe re-load on next search and via
  prewarm.
- Invalidate on settings change: change `zotero.citation-library`,
  re-load with the new libraryID.
- Silent empty on degraded: `db.state = "degraded"` → `search` resolves to
  `[]`.
- Empty-query path: `index.items.slice(0, limit)` shape, no MiniSearch
  invocation.

`prepareFuzzySearch` / `prepareSimpleSearch` references in `service.test.ts`
are dropped along with the mock shims; tests now use real MiniSearch.

## 10. Dependency

Add `minisearch` to `apps/obsidian/package.json` as an app-local dependency.
Approximate cost: ~11 KB minified / ~5 KB gzipped, zero peer deps.

## 11. Open questions / follow-ups

- **Hyphen-guard redundancy.** ICU's `Intl.Segmenter` already splits on `-`
  in most locales; `tokenizer.test.ts` exercises it via a fake segmenter
  (`a-b-c` returned as a single wordlike segment) to keep the guard
  honest. If we ever drop it, that test goes with it.
- **Diacritics setting.** Hard-coded to strip. A `citation.search.ignore-diacritics`
  setting can be added later if a user reports a regression (e.g. an
  intentional `á` / `a` distinction in their library).
- **Recency boost tuning.** Multiplier range, half-life, and even whether
  to keep `Math.exp` versus a cheaper linear decay are seeded values
  (`max=0.1`, `half-life=30 days`). Revisit once real-user queries are
  observed; the knobs live in `engine.ts` constants.
- **Field-boost tuning.** Initial boosts (`title:2.5, creators:2, date:1,
citekey:0.1`) are seeded; expect at least one round of tuning once
  real-user queries are observed. The "Future engine swap" item from
  Stage 3 §10 is resolved by this stage and can be removed from that
  spec.
- **Editor-suggest / quick-switch tests.** Still not added at 3.1. The
  matched-field icon dropping means no Stage 3 i18n keys need pruning;
  call sites in `views/citation-suggest/` and `views/quick-switch/`
  consume the unchanged `SearchHit` shape.

## 12. STAGE3_CITATION_SUGGEST.md amendments

Already landed alongside this spec:

- §2 rows "Engine", "Scoring", "Citekey field" collapse into a single
  "Engine, scoring, and citekey ranking" row pointing at this file.
- §5 `services/item-lookup/` is now a one-line pointer to this file; the
  detailed contents live here.
- §9.2 points at §9.3 below.
- §10 no longer lists "Future engine swap" or "CJK ranking quality at
  scale" — both are resolved by this stage. The remaining bullets
  ("Per-keystroke latency at 50k items", "Multi-note disambiguation") are
  unchanged.
- §3 module layout box lists `engine.ts` + `tokenizer.ts` (no `search.ts`)
  and the matching `engine.test.ts` / `tokenizer.test.ts`.
