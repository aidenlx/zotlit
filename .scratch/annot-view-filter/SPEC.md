# Spec: Annotation view — search & filter

Status: ready-for-agent
Date: 2026-07-22
Design reference: `design-decision.md` and `filter-redesign-proto.html` in this directory (trimmed winning prototype; `rounds/r4/variant-C.jsx` is the winner fragment)

## Problem Statement

A Literature Note or attachment can carry dozens of annotations. In the annotation view they render as one long card list, so finding a specific annotation — "the yellow ones", "everything I tagged `methodology`", "the card where I wrote *compare with Bahdanau*" — means scrolling and scanning the whole list. Zotero's own reader offers color and tag filtering; the ZotLit sidebar offers nothing, so users context-switch back to Zotero just to locate an annotation they want to drag into their note.

## Solution

Two filter surfaces in the annotation view:

1. **Annotation search** — a search icon in the view's nav header toggles a collapsible search row above the card list. The query matches annotation text, comment, tag names, and page label.
2. **Filter bar and tag drawer** — a one-line filter bar at the top of the annotation view, positioned under the nav header / item label / search row. The bar holds small color swatches, a first-tag chip, a trigger chip that toggles an inline tag drawer, and a right-side count cluster. The tag drawer opens directly beneath the bar as a secondary-background panel containing the full alphabetical tag cloud.

Tag chips on individual annotation cards in the list are also interactive filter controls — clicking one toggles that tag in the filter selection, using the same semantics as the bar and drawer chips.

Selected colors are OR-ed, selected tags are OR-ed, and the two groups plus the search query are AND-ed. The card list shows only matching annotations, with a count and a clear affordance always in reach.

## User Stories

1. As a ZotLit user, I want to type a query and see only annotations whose text, comment, tags, or page label match, so that I can find a half-remembered annotation without scrolling.
2. As a ZotLit user, I want to toggle the search row from the nav header and have it disappear when I'm done, so that the view stays compact when I'm not searching.
3. As a ZotLit user, I want to click color swatches in the filter bar to show only annotations in those colors, so that I can use my existing color-coding system to narrow the list.
4. As a ZotLit user, I want to select multiple colors at once and see annotations matching any of them, so that related color categories can be viewed together.
5. As a ZotLit user, I want to click the first tag chip in the bar or any chip in the tag drawer to filter by that tag, so that I can pull up a topic across the document.
6. As a ZotLit user, I want color, tag, and search filters to combine (AND across groups), so that I can express "yellow annotations tagged methodology mentioning softmax".
7. As a ZotLit user, I want a "N of M" count always visible in the bar's right cluster, so that I always know how much of the list I'm seeing.
8. As a ZotLit user, I want a one-click Clear link in the bar (visible while any filter is active), so that I can drop all filters without untoggling each one.
9. As a ZotLit user with many tags, I want the tag drawer's cloud sorted alphabetically and scrollable, so that I can locate a tag by name even with dozens present.
10. As a ZotLit user, I want tags that would produce zero results under my current color/search filter to appear dimmed and disabled, so that I never click into an empty list.
11. As a ZotLit user, I want the filter bar to fit on a single line when space allows and wrap the swatch/tag zone onto additional lines in narrow panes (with the count cluster always pinned top-right), so that filtering costs almost no vertical space when the tag drawer is closed.
12. As a ZotLit user, I want the bar to show the first tag chip directly, so that the most common tag filter is one click away without opening the drawer.
13. As a ZotLit user, I want a trigger chip indicating how many more tags exist, so that I know there is a full tag vocabulary and can open the drawer in one click.
14. As a ZotLit user with 2+ tags selected, I want the trigger chip to show how many other tags are selected (in accent styling), so that I can tell at a glance that multiple tag filters are active.
15. As a ZotLit user, I want the trigger chip's dashed border and chevron to distinguish it from data chips, so that I recognize it as an action that expands the drawer.
16. As a ZotLit user, I want the chevron on the trigger chip to rotate while the drawer is open, so that I can see at a glance whether the drawer is expanded.
17. As a keyboard user, I want every chip, swatch, trigger, and Clear link to be focusable and operable with Enter/Space, so that filtering works without a pointer.
18. As a ZotLit user, I want a filtered-to-empty list to say so and offer "Clear filters", so that a dead end is one click from recovery.
19. As a ZotLit user, I want each displayed item to carry its own filter — restored when I return to it, never inherited from another paper — so that a stale tag selection from a different article never silently empties the new list.
20. As a ZotLit user, I want the tag drawer's scroll position preserved while I toggle chips, so that working through a long tag cloud doesn't jump me back to the top.
21. As a theme user, I want the filter bar and tag drawer to follow my light/dark theme and accent color, so that they look native to my vault.
22. As a motion-sensitive user, I want the chevron rotation and drawer transitions suppressed under reduced-motion, so that the UI respects my system preference.
23. As a ZotLit user, I want dragging a filtered annotation into my note to work exactly as before, so that filtering only changes what I see, not what I can do.
24. As a ZotLit user, I want to click a tag on an annotation card to toggle that tag in the filter, so that I can refine the list directly from the content I'm reading.

## Implementation Decisions

- **Data**: the annotation query already returns text, comment, color, page label, and tags per annotation — no database or query changes. The tag vocabulary and color set are derived from the loaded annotations of the active attachment.
- **State**: filter state (query, selected colors, selected tags, `panelOpen`, search row open) joins the view's per-instance vanilla zustand store, following the existing store/context pattern. When the displayed item changes, filter state resets to that item's own persisted selection (or defaults).
- **Persistence**: selected colors and tags persist per article via Obsidian's per-vault localStorage (`app.loadLocalStorage`/`app.saveLocalStorage`, keyed by indexed item key), mirroring the view's existing attachment-selection persistence. Restored selections are pruned against the loaded annotations so a vanished tag or color never filters invisibly; clearing all filters removes the stored entry. The query, search-row visibility, and `panelOpen` are transient UI state and never persist.
- **Pure filter module**: one new pure module owns the filter predicate and all derived data — filtered annotation list, per-tag availability under the current color+query filter (drives dimming), a stable alphabetical tag ordering for the drawer cloud (independent of selection, so toggling a chip never reorders the cloud), the bar's first-tag chip pick (the first selected tag while filtering, else the first alphabetical tag), and the unselected-tag count. Functions take annotations plus filter state as arguments and return plain results; no store imports, no I/O.
- **Filter semantics**: colors OR within group; tags OR within group (annotation matches if it carries *any* selected tag); groups AND with each other and with the query. Query matching is case-insensitive substring over text, comment, tag names, and page label.
- **Swatch row**: shows the distinct colors present in the loaded annotations, ordered by the standard Zotero palette (unknown colors appended). Real attachments rarely use all colors; only present colors appear.
- **Filter bar**: positioned under the nav header / item label / search row, with a bottom border. The bar is an outer non-wrapping flex row with two children: (a) a **wrappable inner zone** (`flex-1 min-w-0 flex-wrap`) holding the swatches, divider, first-tag chip, and trigger chip; (b) a **count/Clear cluster** (`shrink-0`) pinned at the bar's right edge, top-aligned to the first row and never participating in the wrap. When space allows, everything fits on one line; in narrow panes, the inner zone wraps the swatch and tag groups onto additional lines while the count cluster stays top-right. Contents left to right inside the inner zone:
  1. Small color swatches (compact size).
  2. Thin vertical divider (~16px vertically centered rule). Hidden via a container query in the narrow width band where the inner zone wraps — a fixed-height rule there would dangle at the line break instead of separating two groups on one line.
  3. **First tag chip + trigger** group — uses a content-based flex basis (`flex-auto`) so under width pressure the group wraps to its own line rather than shrinking and overflowing. The first chip's ~110px label truncation remains the within-line pressure valve; the trigger never shrinks or wraps internally.
  4. **First tag chip** — the first tag in selected-first alphabetical order (the first selected tag while filtering, else the first alphabetical tag). Label truncated at ~110px. Clicking toggles that tag's selection.
  5. **Trigger chip** — shown only when the tag vocabulary has 2+ tags. A dashed-border action chip, visually distinct from the solid data chips. Contains a count and a small chevron-down icon that rotates 180 degrees while the drawer is open. While 2+ tags are selected: reads `+{k-1}` (count of other selected tags) in accent color with dashed accent border and faint accent background tint. Otherwise: reads `+{n-1}` (rest of vocabulary) in muted styling with dashed muted border. Clicking toggles the tag drawer. `aria-expanded` reflects drawer state.
  6. **Count/Clear cluster** (always visible, outside the wrappable zone): **"N of M"** count text; **Clear** link, present only while any filter is active.
- **Tag drawer**: an inline panel that opens directly beneath the filter bar on `--background-secondary` with a bottom border. Contains the full alphabetical wrapping tag cloud in a dense layout (~11px chip font with tight padding and gaps); the cloud order is stable and independent of selection, so toggling a chip leaves every other chip in place and the preserved scroll position (User Story 20) stays meaningful. Scrollable past a max height. Zero-hit tags dimmed and disabled unless selected. Chips show the name only. The drawer opens and closes only via the bar's trigger chip.
- **Interaction plumbing**: chips, swatches, and Clear stop propagation so no parent handler double-fires.
- **Tag-chip visual system**: every tag *data chip* — the card chips, the bar's first-tag chip, and the drawer cloud chips — shares one look driven by Obsidian's `--tag-*` theme tokens (`--tag-background`, `--tag-color`, `--tag-border-color`/`--tag-border-width`, `--tag-radius`, `--tag-size`, `--tag-weight`), so all three surfaces read as native Obsidian tags. All three surfaces share one `tailwind-variants` (`tv`) recipe — `tagChipVariants` in `annot-view/tag-chip.ts` — composed from these tokens with prefixed Tailwind utilities, so there is a single source of truth and no borrowing of Obsidian's `.tag` class (which is unlayered — forcing `!important` — and only styles `a.tag`). The recipe's axes: `state` (resting / selected / disabled), `density` (comfortable / dense), `truncate`, and `ring` (a compound with `selected` that the card chip alone opts into). Key accent decisions, constant across surfaces:
  - **Resting** — native tag fill/text/border from `--tag-*`, with `--tag-*-hover` feedback on hover.
  - **Selected (active filter)** — the vault accent (`bg-primary` / `border-primary` / `text-primary-foreground`, plus a `ring` on the card chip) overrides the native tag color, so an engaged filter is unmistakable against the resting chips.
  - **Zero-hit (drawer/bar)** — the native look dimmed to 40% opacity and made non-interactive; hover never fires.
  - **Density** — a variant orthogonal to color: the drawer cloud stays dense (~11px, tight padding); card and bar chips take the tag's own `--tag-size`/`--tag-padding-*`.
  - **Trigger chip** — deliberately *not* a data chip: it shares only the `--tag-radius`, keeping a solid 1px dashed border and muted fill (accent-tinted while 2+ tags are selected) so it reads as an action, not a tag.
- **Styling**: view-local stylesheet plus prefixed Tailwind utilities; state toggling via data attributes, not class juggling from JS. Theme via Obsidian CSS variables so accent/light/dark follow the vault.
- **Status-bar clearance**: the view's scroll area reserves bottom padding (`var(--size-4-8)`) so Obsidian's fixed bottom-right status bar never covers the tail of the annotation list. Applies in any dock, not scoped to a single split.
- **Text**: every user-facing string (count line, Clear, trigger chip text, empty state, search placeholder, tooltips) goes through Paraglide messages.
- **Annotation-card tag chips**: tag chips rendered on each annotation card are interactive filter controls. Clicking a card tag toggles that tag in the filter selection, using the same store action and toggle semantics as the bar's first-tag chip and the drawer's cloud chips. Card tag chips carry interactive hover/pointer affordance and reflect selected state (accent background and border when the tag is in the current selection).
- **Orthogonality**: the existing card-collapse toolbar toggle, refresh, follow modes, attachment selector, and drag-insert are untouched; filtering only changes which annotations render in the list. Annotation-card tag chips serve double duty as filter controls; no other card element gains filter behavior.

## Testing Decisions

- A good test exercises external behavior at the seam: given a list of annotation items and a filter state, assert which annotations survive, which tags are available vs dimmed, how tags are ordered, and what the unselected count is. Tests never reach into the store, the DOM, or component internals.
- **Seam (one)**: the pure filter module. Tested in Vitest running in Node with plain object fixtures — no jsdom, no Obsidian mock beyond what the harness already provides.
- **Excluded from automated tests**: the bar layout, trigger chip styling transitions, and drawer open/close rendering. These are verified manually in Obsidian against the prototype (idle / filtering / no-match / many-selected states).
- **Prior art**: the sibling pure-function test in the same view directory (target resolution) and the query tests in the db package — same fixture-in, plain-assertion-out shape.

## Out of Scope

- Persisting filter state into workspace layout, or persisting the transient surfaces (query text, search-row visibility, `panelOpen`).
- Filtering by annotation type, sorting, or grouping of the card list.
- Cross-attachment or library-wide filtering (the filter bar scopes to the active attachment's annotations).
- Any Zotero-side or companion-app awareness of the filter.
- Fuzzy/ranked search (plain substring only).
- Tag renaming, tag management, or tag search inside the drawer (explicitly removed during design).

## Further Notes

- The design went through two grilling cycles. The first (5 rounds, recorded in `design-decision.md` under "Decisions") settled the bottom-drawer placement. A redesign cycle (4 rounds, recorded under "Redesign decisions") replaced it with the top filter bar + inline drawer. `filter-redesign-proto.html` is the visual reference for the final design; `rounds/r4/variant-C.jsx` is the winning fragment.
- The prototype's stress dataset (30 annotations, 38 tags, long tag names, all 8 colors) is a good manual-QA scenario for the tag drawer.
