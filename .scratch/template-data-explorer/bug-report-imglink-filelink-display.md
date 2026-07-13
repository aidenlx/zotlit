# Bug report: link-helper row rendering (imgLink / fileLink)

Observed in the running Template Data Explorer on a real annotation node (`type: "highlight"`, key `JDJKX3N6`).

## Screenshots

![Note Root — top-level item fields (title, abstractNote, date, url, volume, pages, publicationTitle, DOI)](/Users/aidenlx/Library/Application%20Support/CleanShot/media/media_CNMhb4Tjbv/CleanShot%202026-07-13%20at%2000.22.33@2x.png)
*Note Root fields render correctly — included for context, no issue here.*

![Expanded annotation node — imgLink/fileLink rows showing the detached-label symptom](/Users/aidenlx/Library/Application%20Support/CleanShot/media/media_geqQkcOFAk/CleanShot%202026-07-13%20at%2000.22.27@2x.png)
*Annotation `0` expanded under `annotations [12]`. Between `imgLink null` and `fileLink (…)` a wrapped value line appears with no visible key label — the symptom described below.*

## Symptom

```
imgLink null
        [Hensher和Collins – 2011 – Interrogation of Response...
fileLink (file:///Users/aidenlx/Zotero/storage/T2P8T29G/Hensh…)
backlink zotero://open/library/items/T2P8T29G?annotation=JDJKX3N6&page=62
comment hello world testing
```

The line between `imgLink null` and `fileLink (…)` has no visible key label, breaking the tree's "every value has a labeled key" contract.

## Root causes

### 1. Orphan-looking line = `fileLink`'s value wrapping, not a missing label

`HelperRow` in `apps/obsidian/src/views/template-data-explorer/DisplayTree.tsx` renders `label`, `evaluated`, `signatureHint` as sibling `<span>`s inside a `zt:flex zt:items-center zt:gap-1` row, with no `truncate` / `min-w-0` / `whitespace-nowrap` guard on the value span.

`fileLink`'s evaluated value is a full Markdown link string (`[filename](file://…)`) produced by `fileUrlLink` (`apps/obsidian/src/lib/markdown-link.ts:11-19`) via `attachmentFileLink` (`apps/obsidian/src/lib/annotation-render.ts:40-49`). For a long file path this value wraps to two lines. Because the row uses `items-center`, the single-line `fileLink` label re-centers against the two-line value block — the `[filename]` half visually detaches upward and reads as its own keyless row above `fileLink (…)`.

It is the same `HelperNode` (kind `"helper"`, label `"fileLink"`), not a distinct node missing a label.

**Fix direction:** constrain/wrap the `HelperRow` value span (e.g. `min-w-0` on the row, `break-all` or truncation with full value on hover/copy) so a long value can't detach from its label.

### 2. `imgLink` prints literal `"null"`

`annotationImageLink` (`apps/obsidian/src/views/template-data-explorer/inert-resolvers.ts:127-156`) returns one of three things:

- a branded inert-placeholder function (`markInertPlaceholder`, `display-tree.ts:61-70`) for the ADR-0005 "not yet imported" case (`inert-resolvers.ts:139`, `:153`)
- a real link function when already imported
- raw `null` at `inert-resolvers.ts:132` (`if (cachePath == null) return null;`) — the case where the annotation type has no cached image at all

Per `TemplateAnnotation.imgLink`'s own doc (`zt-template-annot.ts:59-67`), `null` here means "no cached excerpt image for this annotation type (everything but `image`/`ink`)" — this annotation is `type: "highlight"`, so `null` is legitimate data, not a missing-import case.

`classifyValue` (`display-tree.ts:189-209`) only checks `typeof value === "function"` to detect an inert placeholder. Raw `null` falls through to `valueTypeOf` → `"null"` → a generic `ValueNode`, rendered by `formatPrimitive` (`DisplayTree.tsx:170-179, 191-196`) as the bare string `"null"` — indistinguishable from any other null scalar (e.g. `authorName null`).

This is arguably correct behavior for *this* annotation (it really has no image), but the tree currently has no way to distinguish three different meanings that all print as scalar `null`:
- not-yet-imported placeholder (should get inert-placeholder treatment)
- helper not applicable for this variant (this case)
- an unresolved/unexpected null

### 3. Formatting inconsistency across link helpers

`noteLink`, `fileLink`, and `imgLink` all route through the same `HelperRow`, so there's no separate rendering code path per helper. But:
- `imgLink`'s null case skips `HelperRow` entirely (no signature hint, no link-shaped styling) — it degrades to a plain scalar.
- `fileLink`'s long value is what triggers the wrap-and-detach artifact in #1.

Net effect: the three link helpers look inconsistent in the UI even though they share one implementation, because only some of their possible return shapes actually reach `HelperRow`.

## Suggested next step

Decide whether "helper not applicable for this variant" (case 2) should render as a distinct display-node kind (e.g. reuse the inert-placeholder styling with a different label, or a new "n/a" kind) versus staying a plain null scalar — then fix `HelperRow`'s layout (case 1) regardless, since it's a genuine visual bug independent of that decision.

## Additional issue: long scalar values (e.g. `abstractNote`) render terribly at Note Root

Visible in the first screenshot above: `abstractNote` prints its full multi-paragraph value inline, expanded by default, wrapping across ~30 lines and pushing every sibling field (`date`, `url`, `volume`, `pages`, `publicationTitle`, `DOI`) far down the tree. Same `zt:flex zt:items-center` row layout as the `HelperRow` issue above (`ValueRow`, `DisplayTree.tsx`) — long values vertically re-center the row instead of top-aligning against the key.

Two distinct problems, both in `ValueRow`:

1. **No default collapse for long text values.** Every other kind of long content in the tree (arrays, objects, annotations) collapses by default and expands on demand; a long string scalar has no equivalent — it always renders in full. Should default to a collapsed/truncated form (e.g. first line or N characters + "…", expand-on-click to see the rest), consistent with how the tree treats every other kind of "the rest is a lot of content."
2. **Vertical centering instead of top alignment.** `items-center` on the row means a multi-line value pushes its own key label down to vertically center against the wrapped text, instead of both key and value starting at the same top line. Needs `items-start` (or equivalent) so key and value both top-align regardless of value height — same fix family as the `HelperRow` wrap issue above.

## Resolution (redesign, 2026-07-13)

Fixed as part of the react-json-view-style tree redesign (`DisplayTree.tsx` +
`display-tree.ts`).

- **Case 1 — orphan/detached value line.** The row is now `items-start` (top
  aligns key + value regardless of value height) with `min-w-0`, and `fileLink`'s
  Markdown-link value renders as a compact anchor showing just the filename
  (`LinkValue`), so a long `file://` path can no longer wrap-and-detach from its
  label.
- **Case 2 — `imgLink` prints `null`.** Decision: keep it a plain `null` scalar
  (no new node kind). For `imgLink` the only raw-`null` path is "no cached excerpt
  image for this annotation variant" — legitimate data, not a missing import (that
  path returns an inert placeholder). The redesign's per-primitive tones now render
  `null` in a distinct faint-italic style, visually separating it from string
  values, which was the actual readability complaint. A dedicated "n/a" kind would
  be speculative over-engineering.
- **Case 3 — link-helper inconsistency.** All three link helpers route through the
  same `HelperRow`, reordered to `label · signature · value`; the value passes
  through the shared string renderer (anchor / hex-swatch / long-text collapse), so
  every reachable return shape is styled consistently.
- **Long scalar values (e.g. `abstractNote`).** `LongText` collapses any value over
  ~140 chars or containing a newline to its first line with a `more`/`less` toggle,
  matching how containers collapse by default; combined with `items-start` this
  keeps one long field from pushing its siblings off-screen.
