# Pandoc Reference List hover parity inventory

Research for [#748](https://github.com/aidenlx/zotlit/issues/748), a sub-ticket of the concise
citation hover popover map [#746](https://github.com/aidenlx/zotlit/issues/746). This note
enumerates every hover behavior the Obsidian community plugin "Pandoc Reference List" (PRL)
implements, cited to source, and marks each one **adopt / adapt / drop** for ZotLit's popover
against the decisions #746 has already locked. It does not prescribe an exact port of PRL's
tooltip — PRL is a hand-rolled `fixed`-position `<div>` tooltip; ZotLit's destination is native
Obsidian popover machinery (`hover-link` / `HoverPopover` / Page Preview).

## Scope and sources

All line numbers are against the local checkout at
`~/repo/zotlit-repo/obsidian-pandoc-reference-list`, read on 2026-08-14. Files read in full:

- `src/tooltip.ts` — the `TooltipManager` class: show/hide, timers, positioning, content assembly.
- `src/markdownPostprocessor.ts` — reading-mode citation-span construction and preview binding.
- `src/editorExtension.ts` — CM6 live-preview decorations and editor-mode binding.
- `src/settings.tsx` — the settings tab, including every tooltip-adjacent toggle/slider.
- `styles.css` — `.pwc-tooltip`, `.pwc-tooltips`, and related rules.
- `src/bib/bibManager.ts` — `getBibForCiteKey`, `getNoteForNoteIndex`, `prepBibHTML` (the
  three-icon-button row PRL does have), bibliography-entry resolution.
  `src/view.ts`, `src/main.ts` — checked for sidebar interplay and setting wiring.

Repo-wide greps for `tooltipDelay`, `150`, `pwc-tooltip`, and `hideLinks` turned up nothing
outside these files (`rg -n` over `src/` and `styles.css`).

## 1. Trigger and dismissal timing

**`tooltipDelay` setting.** A slider, 0–7000 ms in 100 ms steps, default 400 ms
(`src/settings.tsx:22` default, `:362-378` slider UI). It gates the show-timer in both binding
paths; it does not gate the hide-timer.

**Show timer (preview mode).** `bindPreviewTooltipHandler` (`src/tooltip.ts:142-149`) sets a
`setTimeout` of `tooltipDelay` ms on `pointerover`, clearing any pending show/hide timer first.
`pointerout` (`:151-161`) clears the show timer immediately and, if a tooltip is open, starts a
flat **150 ms** hide timer (not the `tooltipDelay` value) — grace time regardless of how long
`tooltipDelay` is set to.

**Show timer (editor mode).** `getEditorTooltipHandler` (`src/tooltip.ts:187-238`) is a single
`pointerover` handler (CM6 `domEventHandlers`, no separate `pointerout` — see below) that tracks
an `activeKey` string. Moving onto a `data-citekey` element that differs from `activeKey`
immediately calls `hideTooltip()` for the old one, then arms a `tooltipDelay`-ms show timer for
the new one. Moving onto a *non-citekey* element (or off any citekey) starts the same flat
**150 ms** hide timer, gated by `isClosing` to avoid re-arming while already pending
(`:222-235`).

**150 ms grace on the tooltip itself.** `handleToolipHover` (`src/tooltip.ts:164-185`, preview
path only) re-arms whenever the pointer leaves the tooltip: `pointerout` on the tooltip element
starts another 150 ms timer; `pointerenter` cancels it. This is a recursive close-then-recheck
loop, so the tooltip survives indefinitely as long as the pointer keeps re-entering it inside
each 150 ms window.

**Hover-the-tooltip persistence.** `showTooltip` attaches `pointerover`/`pointerout` on the
tooltip div itself to flip `isHoveringTooltip` (`:89-94`). In preview mode this feeds
`handleToolipHover`'s recursive loop above, so moving the pointer from the citation onto the
tooltip keeps it open. In editor mode there is **no equivalent recheck** — `getEditorTooltipHandler`
only inspects `isHoveringTooltip` once, inside its own 150 ms timer callback (`:227`), with no
loop that re-arms on the tooltip's own `pointerout`. So hovering the tooltip content still works
once (the callback sees `isHoveringTooltip === true` and skips the close), but there is a real
asymmetry versus preview mode's indefinite-loop behavior.

**Scroll-capture dismissal.** `showTooltip` adds a capturing `scroll` listener on `el.win`
(`:120-126`); any scroll event, anywhere (`capture: true`, so it fires before it can be
consumed), immediately calls `hideTooltip()`. Editor mode additionally wires a CM6 `scroll`
dom-event-handler (`:194-200`) that clears both pending timers and resets `activeKey` — belt and
suspenders for the same intent, since CM6 scroll won't always bubble to `window`.

**Dismiss on internal click.** `showTooltip` also closes the tooltip if the user clicks an `<a>`
or `.clickable-icon` inside it (`:95-104`) — i.e., following a link or pressing one of the
entry's action buttons closes the popover rather than leaving it open over the new context.

**Preview vs. editor binding differences, summarized:**

| | Preview (`bindPreviewTooltipHandler`) | Editor (`getEditorTooltipHandler`) |
| --- | --- | --- |
| Events | Two listeners per span: `pointerover` + `pointerout` (native DOM) | One `domEventHandlers` object shared across the whole editor: `pointerover` (delegated) + `scroll` |
| Re-entry while open | Recursive `handleToolipHover` loop keeps it open indefinitely | Single `isClosing`-gated check, no loop |
| Positioning anchor | `el.getBoundingClientRect()` of the specific `<span>` | Same — `showTooltip` takes the CM6 decoration/widget's DOM element as `el`, so anchor logic is identical once `showTooltip` runs |
| Cancels on same-target re-hover | Handler runs per-element; no cross-element key tracking needed | Tracks `activeKey`, ignores repeat `pointerover` events on the same citekey while a tooltip is already shown for it |

## 2. Content composition

**Citekey → bibliography entry.** `getBibForCiteKey(file, key)` (`src/bib/bibManager.ts:575-597`)
looks up the file's cached `citeBibMap` (built per-file in `getReferenceList` from
`engine.makeBibliography()` output, `:718-736`), parses the stored HTML string, tags the root
element with `data-citekey`, and runs it through `prepBibHTML` (adds the button row, applies
`hideLinks`). Returns `null` if the file isn't cached or the key isn't resolved.

**Multi-key stacking and the 100-char clip.** `showTooltip` (`src/tooltip.ts:44-64`) splits
`el.dataset.citekey` on `|` and calls `getBibForCiteKey` per key, appending each returned element
into one `DocumentFragment`. **Only when `keys.length > 1`** does it clip: it finds
`.csl-right-inline` (falling back to `.csl-entry`, then the element itself), takes `innerHTML`,
and runs it through `text-clipper`'s `clip(inner, 100, { html: true })` (`:53-59`), replacing the
target's `innerHTML` with the clipped result. A single-citekey tooltip is never clipped —
clipping is specific to citations with more than one key stacked in one bracket
(e.g. `[@a; @b]`).

**Note-index tooltip path.** If `el.dataset.noteIndex` is set, content composition takes a
completely separate branch (`:37-43`): it calls `bibManager.getNoteForNoteIndex(file, noteIndex)`
instead of the per-key bibliography lookup. That method (`src/bib/bibManager.ts:557-573`) finds
the cached `RenderedCitation` whose `noteIndex` matches, requires `cite.note` to be set, parses
`cite.note` as HTML, and returns its child nodes — the fully rendered CSL "note" citation-style
output (e.g. Chicago full-note style), not a bibliography entry. This path never clips and never
stacks multiple keys (a note citation is inherently singular).

**Missing/unresolved fallback.** If no key in the stack resolves to bibliography HTML,
`content` stays `null`; `showTooltip` adds `is-missing` to the tooltip and renders
`<em>No citation found for {el.dataset.citekey}</em>` (`:82-87`), where the interpolated value is
the raw `data-citekey` attribute (pipe-joined key list, if it was a stack).

## 3. Presentation

**`.pwc-tooltip` box model.** `position: fixed`, `width: 95vw` capped at `max-width: 300px`,
`padding: 10px`, `background-color: var(--background-primary)`, `1px solid
var(--background-modifier-border)`, `border-radius: 6px`, drop shadow
`0 2px 10px rgba(0,0,0,0.1)`, `z-index: var(--layer-popover)`, flex column with
`gap: var(--size-4-2)`, `user-select: text` (`styles.css:207-226`). No arrow/caret element exists
anywhere in the CSS or the DOM construction in `tooltip.ts` — it is a plain floating card.

**Positioning and viewport-edge flipping.** Computed in a `setTimeout(..., 0)` after the tooltip
is appended, so it can measure its own `getBoundingClientRect()` (`src/tooltip.ts:106-118`):

- Horizontal: default `left = rect.x` (align to the hover target's left edge). If
  `rect.x + divRect.width + 10 > viewport.width` (would overflow the right edge, with a 10px
  margin), it flips to `rect.x - (rect.x + divRect.width + 10 - viewport.width)` — i.e. it shifts
  left just enough to clear the viewport's right edge, not a full flip to the target's other
  side.
- Vertical: default `top = rect.bottom + 5` (5px below the target). If
  `rect.bottom + divRect.height + 10 > viewport.height` (would overflow the bottom, with a 10px
  margin), it flips to `rect.y - divRect.height - 5` — fully above the target instead, 5px gap.
- There is no explicit top/left-edge underflow handling (no clamp if the flipped position would
  itself go negative) — only right/bottom overflow is guarded against.
- A degenerate case: if the hover target's own rect is `(0, 0)` (e.g. detached/not laid out),
  `showTooltip` bails via `hideTooltip()` rather than positioning at the origin (`:72-74`).

**`hideLinks` / collapsed-links interaction.** `hideLinks` (`src/settings.tsx:43`, toggle at
`:272-280`, "Replace links with link icons to save space") is a **content/rendering** setting,
not a trigger-surface setting. When on, `showTooltip` adds a `collapsed-links` class to the
tooltip div in addition to `pwc-tooltip` (`src/tooltip.ts:66-78`, applied twice — once via string
concat, once via `addClass`, redundantly). `prepBibHTML` (`src/bib/bibManager.ts:815-820`) also
sets `aria-label` on every `<a>` to its link text when `hideLinks` is set, and the CSS
(`styles.css:188-205`) shrinks the link's own font to `0` and replaces it with a `::after`
pseudo-element sized at `1em` using an inline SVG "link" mask icon — the same rule applies to both
`.pwc-tooltip.collapsed-links` and `.pwc-reference-list.collapsed-links` (the sidebar), so the
setting is shared across both surfaces. `hideLinks` never changes *whether* or *what* triggers a
tooltip, only how in-entry hyperlinks (URLs/DOIs in the formatted citation) render inside it —
orthogonal to trigger surface and to the entry-vs-note content-path decision above.

**`Show citekey tooltips` setting is not a JS gate.** `showCitekeyTooltips`
(`src/settings.tsx:44`, toggle at `:346-360`) toggles a `pwc-tooltips` class on `document.body`
(`src/main.ts:107-110`, `:298-301`). Every CSS rule scoped under `.pwc-tooltips` in `styles.css`
(`:232-279`) styles the **citation marks themselves** — underline, color, unresolved-color — not
`.pwc-tooltip` (singular, the popover box), which has no such gate. `bindPreviewTooltipHandler`
and `editorTooltipHandler` are registered unconditionally in `main.ts:74-80`, with no read of
`showCitekeyTooltips` anywhere in `tooltip.ts`. Net effect: turning the setting off removes the
visual underline/color cue that a citation is hoverable, but hovering it still opens the tooltip
— the setting name promises a feature toggle it doesn't fully deliver.

**Tooltip font size** is a separate Style-Settings-plugin variable,
`--pwc-tooltip-font-size` (`styles.css:16-23`, `:74`, default `14px`), independent of the
sidebar's `--pwc-font-size`.

## 4. Other affordances

**Three-icon button row (PRL's closest equivalent to #746's three-button row).**
`prepBibHTML` (`src/bib/bibManager.ts:815-892`) appends a `.pwc-entry-btns` column of
`.clickable-icon` divs to every `.csl-entry-wrapper`, used identically in both the tooltip and
the sidebar (`inTooltip` only suppresses the click-to-copy affordance, not the buttons):
"Open literature note" (`sticky-note` icon, resolves via `metadataCache.getFirstLinkpathDest` on
`@citekey` or bare `citekey`, opens with `Keymap.isModEvent` new-pane support), "Open in Zotero"
(`lucide-external-link`, only rendered if a Zotero `select://` link was resolved via
`getZLinksForKeys`, Zotero-pull mode only), and one "open attachment" icon per resolved PDF
(`lucide-file-text`, `file://` URL, also Zotero-pull only). The row is omitted entirely if none
of the three link kinds resolve (`:854`). This is a **flex column**, not a cursor-proximal row,
and it lives inside each stacked entry rather than as a separate hover-anchored control.

**Click-to-copy.** Outside the tooltip (i.e. only in the sidebar, `inTooltip` is falsy),
`prepBibHTML` also wires each `.csl-entry` itself to copy its text to the clipboard on click,
with an `aria-label="Click to copy"` (`:829-831`). The tooltip explicitly opts out of this
(`inTooltip: true` passed from `getBibForCiteKey`, `:594`).

**Settings surface.** All tooltip-adjacent settings live in one flat settings tab
(`src/settings.tsx`): `hideLinks`, `renderCitations` (live-preview inline rendering, gates the
CM6 `citeDeco` widget path independent of tooltips), `renderCitationsReadingMode`,
`renderLinkCitations` (whether `[[@key]]`-style wikilink citations count at all — see
`markdownPostprocessor.ts:47-50` and `editorExtension.ts` citation-segment calls), and
`enableCiteKeyCompletion` (autocomplete, unrelated to hover). `tooltipDelay` and
`showCitekeyTooltips` are the two tooltip-specific ones (`:346-378`).

**Status-bar quick-toggle menu.** Clicking the status-bar icon opens a `Menu` with a "Show
citekey tooltips" checkbox item mirroring the settings-tab toggle, plus "Show citekey
suggestions" and "Refresh bibliography" (`src/main.ts:183-236`) — a command-adjacent affordance,
not a Command Palette command. There is no separate Command Palette command for hover; the only
registered command is `focus-reference-list-view` (`:99-105`), which opens the sidebar and is
unrelated to hover.

**Sidebar (Reference List view) interplay.** The sidebar (`src/view.ts`) shares `bibManager` and
the `hideLinks`/`collapsed-links` styling with the tooltip, and shares the same
`.pwc-entry-btns` action-row markup via `prepBibHTML`. It does **not** use `TooltipManager` at
all — its own hover affordance is native Obsidian `aria-label` tooltips (`el.setAttribute
('aria-label', 'Click to copy')`, `view.ts:32-35` sets `aria-label-position` based on which side
the leaf is docked). There is no code path where hovering a citation in the editor/preview
opens or highlights anything in the sidebar, or vice versa — the two surfaces are independent
consumers of the same underlying bibliography cache.

## Parity checklist (adopt / adapt / drop)

Every item below is judged against #746's locked decisions: native `hover-link`/`HoverPopover`
machinery, unclipped stacked entries, formatted note text for note markers, a cursor-proximal
three-button row, desktop-only, default-on, and the bare-hover/mod-key split between the concise
popover and Citekey Navigation's existing page preview.

### Trigger and dismissal timing

- [ ] **Hand-rolled `fixed`-div tooltip as the mechanism** — drop. #746 mandates native
  `hover-link`/`HoverPopover`/Page Preview; PRL's whole `TooltipManager` class is superseded by
  that machinery, not ported.
- [ ] **`tooltipDelay` configurable show-delay (0–7000 ms slider)** — adapt. Native
  `hover-link` has its own delay handling (Obsidian's built-in hover-delay setting already
  covers this vault-wide); don't reintroduce a plugin-local duplicate slider, but confirm the
  popover honors Obsidian's existing hover-delay preference rather than firing instantly.
- [ ] **150 ms hide grace timer on leaving the trigger** — adapt. `HoverPopover` already
  implements its own leave-grace behavior; rely on the native timing rather than re-deriving
  PRL's flat 150 ms constant.
- [ ] **Hovering the tooltip content keeps it open (preview mode's recursive re-arm loop)** —
  adopt (the requirement, not the mechanism). `HoverPopover` natively supports pointer-into-popover
  persistence; the *behavior* PRL wants is already native-first, so no custom loop is needed.
- [ ] **Editor-mode hover-into-popover asymmetry (single-check, no loop)** — drop. This is a
  latent PRL bug from having two independent binding paths; native machinery gives one
  consistent implementation for both editor and reading surfaces, so the asymmetry has no
  reason to exist.
- [ ] **Scroll-capture dismissal (capturing `window` `scroll` listener + CM6 `scroll` handler)**
  — drop as a custom mechanism. `HoverPopover` already repositions/dismisses correctly on
  scroll; don't hand-roll a second scroll listener.
- [ ] **Dismiss on internal link/button click** — adopt. Clicking through (open literature
  note / select in Zotero / open attachment, or a link inside the entry) should close the
  popover rather than leave it stranded; implement this against whatever dismiss API the native
  popover exposes.
- [ ] **Distinct preview-vs-editor binding paths (`bindPreviewTooltipHandler` vs
  `getEditorTooltipHandler`)** — drop. #746 already commits to instrumenting all four rendered-
  citation surfaces (`citekey-editor`, `citekey-reading`, `wikilink-editor`, `wikilink-reading`)
  through one native `hover-link` source id, so PRL's two-hand-rolled-paths split doesn't
  transfer.

### Content composition

- [ ] **Citekey → bibliography-entry resolution via a per-file cache** — adopt (the concept).
  ZotLit's popover needs an equivalent per-citekey-to-formatted-entry lookup; the concrete
  mechanism will come from the #737 typed-AST seam, not PRL's `citeBibMap`.
- [ ] **Multi-key stacking (append one entry per key in the bracket)** — adopt. Stacking
  multiple resolved entries for one bracket citation is the right shape and matches #746.
- [ ] **100-char clip on stacked (but not single) entries** — drop. #746 explicitly wants full
  formatted entries **unclipped** for multi-item citations; PRL's clipping-only-when-stacked
  rule is the one behavior the map calls out by name as not wanted.
- [ ] **Separate note-index content path (`getNoteForNoteIndex`, fully rendered note-style
  text, no clipping, no stacking)** — adopt, mechanism differs. #746 wants note-class markers to
  show the fully formatted note text — the same *outcome* PRL's separate path produces. The
  seam differs (typed AST + per-item entry/note API from #737/#740 instead of a cached
  `RenderedCitation.note` HTML string), so the concept transfers but the plumbing is new.
- [ ] **Missing/unresolved fallback text (`No citation found for {key}`, `is-missing` styling)**
  — adopt, reword. An unresolved-citekey fallback message is a real gap PRL fills that ZotLit
  needs too; keep the concept, write the string per this repo's i18n house style
  (`/i18n-ui-text`) rather than reusing PRL's wording verbatim.

### Presentation

- [ ] **`.pwc-tooltip` custom box (fixed position, 300px max-width, shadow, radius, no
  arrow/caret)** — drop. Native `HoverPopover` supplies its own chrome; a hand-rolled box
  duplicates what the native machinery already renders and would fight Obsidian's own popover
  styling.
- [ ] **Manual viewport-edge flip (`getBoundingClientRect` + `setTimeout` reposition, right/
  bottom-only overflow guard)** — drop. `HoverPopover` already handles edge-aware positioning;
  re-deriving PRL's partial (right/bottom-only, no left/top clamp) logic would be strictly worse
  than what native machinery already does.
- [ ] **`hideLinks`/collapsed-links (shrink link text, show a link-icon glyph instead)** — drop
  from the popover's scope. It's an orthogonal formatted-citation-rendering preference PRL
  shares between its tooltip and its sidebar; ZotLit has no equivalent "collapse links" setting
  in scope for this popover, and #746 doesn't ask for one. Note it as a possible future
  formatted-entry-rendering knob, not a hover-feature requirement.
- [ ] **`showCitekeyTooltips` setting gating only the citation-mark underline/color, not the
  actual tooltip trigger** — drop. #746 commits to default-on with no feature flag; there is no
  "off but marks still hoverable" state to reproduce, and PRL's own implementation of this
  toggle is arguably a bug (the setting doesn't do what its label promises).
- [ ] **Separate tooltip-specific font-size Style Settings variable** — drop. Popover typography
  should follow ZotLit's own styling conventions (`obsidian-css` skill, Obsidian semantic
  tokens), not a plugin-local CSS custom property exposed via Style Settings.

### Other affordances

- [ ] **Three-icon action column per bibliography entry (open literature note / open in Zotero
  / open attachment)** — adapt. This is PRL's closest analog to #746's three-button row, but
  #746 specifies a **cursor-proximal row** (popover-edge-anchored, one row per stacked item)
  where PRL renders a **flex column embedded inside each entry** with no cursor-proximal
  positioning and no per-entry row-vs-column distinction; adopt the three actions, discard the
  in-entry-column placement.
  Note: PRL's "Open literature note" resolves via `metadataCache.getFirstLinkpathDest`, its
  "Open in Zotero" and attachment icons only exist in Zotero-pull mode — ZotLit's equivalents
  should resolve through ZotLit's own citekey/Zotero-item plumbing, not this lookup.
- [ ] **Dismiss-on-click-through inside the entry (`<a>` / `.clickable-icon` closes the
  tooltip)** — adopt. Already covered above under timing; repeated here because it interacts
  directly with the three-button row.
- [ ] **Click-to-copy on sidebar entries (suppressed inside the tooltip itself)** — drop from
  hover-feature scope. This is sidebar-only behavior in PRL (`inTooltip` explicitly disables it
  in the tooltip); no ZotLit sidebar equivalent is in scope for this popover ticket.
- [ ] **Flat settings tab with `tooltipDelay` + `showCitekeyTooltips` as the only
  tooltip-specific settings** — drop. #746 is default-on with no feature flag, so neither a
  delay slider nor an on/off toggle is planned; any future settings surface belongs to a
  different ticket.
- [ ] **Status-bar quick-toggle menu item for "Show citekey tooltips"** — drop. No feature flag
  to toggle; not applicable under #746's default-on decision.
- [ ] **No Command Palette command for hover** — adopt (i.e., match by doing nothing). PRL has
  no hover-related command either; ZotLit's popover doesn't need one — hover is a passive
  affordance, not a command target.
- [ ] **Sidebar has zero code-level interplay with the tooltip (independent consumers of one
  bibliography cache, no cross-highlighting)** — adopt (as a non-goal). There is nothing to
  reproduce here beyond noting that ZotLit's popover should likewise not assume or require any
  wiring to a references/bibliography sidebar; #746 has no sidebar in scope for this popover.
