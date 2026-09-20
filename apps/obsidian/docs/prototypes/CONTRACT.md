# Variant contract — ZotLit annotation view prototype

You are building **one** UI variant for a throwaway prototype gallery. Three variants are
spliced into one HTML file; the user flips between them and picks.

Read `/tmp/zotlit-annot-proto/prototype-annot-view.html` first — its `<head>` comment is the
design plan and its `<script type="text/jsx">` is the import contract and the shared store.

## The question you are answering

ZotLit's Zotero annotation view, docked in an Obsidian **right sidebar (~340px)**, read by a
researcher whose expertise is their research, not software. They do not know what a
"capability", a "local API" or an "attachment key" is.

What it does wrong today:

1. **The pane's real news lives in a hover tooltip.** When Zotero isn't running, the only
   place that says so is a black tooltip — three lines of body text — that covers the entire
   pane. A researcher who doesn't hover never learns why editing is off.
2. **The visible copy states the wrong cause.** The pane says "Open a literature note or a
   Zotero PDF to see annotations" while the actual blocker is that Zotero is closed. The
   reader follows the instruction and nothing changes.
3. **A secondary control outshouts the content.** "Enable editing" is a filled text button in
   a toolbar of icon buttons — the heaviest thing on screen — while the pane's own message is
   centred grey text with no next action.
4. **Seven rows of chrome** can stack above the list: toolbar, item title, attachment picker,
   condition lines, search row, filter bar, tag panel.
5. **One type size for everything** (12px). The excerpt — the thing actually read — is 12px
   with `leading-tight` under a 3-line clamp.
6. **Multi-column masonry breaks page order.** CSS `columns` reads down column 1 then down
   column 2, so annotations leave document sequence the moment the pane widens.

Decided with the user before building, and binding on every variant:

- Scope is the whole view: chrome, states, filtering and the annotations themselves.
- **When Zotero is closed, the pane's own body carries the message.** Never a tooltip.
- Optimise for ~340px first, then show it expand.

## Hard contract

- Write **exactly one** paramless `function Variant<KEY>() { ... }` to your assigned path.
- **Every top-level name in your file must be prefixed with your variant letter**
  (`ACard`, `AToolbar`, `A_PAGE_ORDER`). All three variants are spliced into one module
  scope; an unprefixed helper collides and blanks the page.
- Your component **wraps itself**: `return <ObsidianFrame>…</ObsidianFrame>`. Everything
  inside is yours; `ObsidianFrame` is the Obsidian host window and is off-limits.
- **All state comes from `useProto()`**, never from props. Your component takes none.
- Return **only the absolute file path** as your final message. No code in the reply.

## What is already in scope (do not redefine)

```js
useProto()      // { ...state, set, toggleColor, toggleTag, clearFilters, select }
canEdit(s)      // Zotero will accept a write
hasItem(s)      // pane has an item resolved
condition(s)    // null | { tone, title, body, action }  ← the Zotero-closed message
filterActive(s) // any colour/tag/query filter on
visibleAnnots(s)// the filtered list, in page order
ANNOTS, ALL_COLORS, ALL_TAGS, ITEM, ZC, COLOR_NAME
Ic, cx, ObsidianFrame
```

State fields: `scenario`, `width`, `selectedKey`, `editingKey`, `query`, `colors`, `tags`,
`expanded`, `sheet`.

An annotation: `{ key, page, color, type, text, comment, tags, img? }` where `type` is
`highlight | underline | image | note`. `text` is null on `image`/`note`; `comment` is null
on many. `img` is a data-URI figure.

## Scenarios you must render (the switcher drives them)

| `scenario` | What it means | What you must show |
| --- | --- | --- |
| `reading` | Zotero open, editing authorised | The full list, editing available |
| `zotero-closed` | Zotero not running; list still reads from a saved copy | The list, **plus the condition stated in the pane body**, and every editing affordance visibly unavailable |
| `no-item` | Zotero not running **and** nothing resolved — the reported screenshot | An empty state whose leading sentence is the **real** cause, with one next action |
| `saving` | One write in flight | Your choice of which card; show it saving without the list jumping |
| `no-match` | Filters applied, nothing satisfies them | Name the filter and offer the exit |

`expanded` toggles excerpt truncation (collapsed clamps, expanded shows all).
`width` is 340 / 520 / 900 — the pane box resizes and `@container` queries fire.

## Craft rules (these are the skills the user asked for)

**Colour.** Tokens only: `bg-ground bg-raised bg-sunken text-ink text-muted text-faint
border-line text-accent bg-accent bg-accent-soft text-notice bg-notice-soft font-ui
font-quote`. Never a Tailwind stock colour (`bg-slate-*`, `text-gray-*`) — it breaks the dark
scheme. Zotero's highlight hex is **data**: pass it through `style={{"--c": a.color}}` and
reference `[var(--c)]`, never a token.

**Type.** Inter (`font-ui`) for all chrome, sentence case. `font-quote` (Source Serif 4) for
the excerpt alone — it is a quotation lifted from a paper. Scale: 11px tracked
(`tracking-[0.04em]`) micro-labels, 12px chrome, 13px comment/UI body, 14px/1.5 serif
excerpt. Nothing below 11px. Any text that wraps to 3+ lines needs `leading-relaxed` or
looser — never `leading-tight` under a clamp. `tabular-nums` on page numbers and counts.
`text-wrap: pretty` on descriptions, `text-balance` on headings.

**Layout.** Group with space, not lines: ≥2× the gap between groups that you use within one.
Separator lines only where space genuinely cannot carry the structure. Logical properties
throughout (`ps-`, `pe-`, `ms-`, `me-`) — never `pl-`/`pr-`. No fixed width or height on a
text container. Interactive things must look interactive: a background shape, a border, or a
consistent placement zone. Never park a critical action where scrolling clips it.

**Motion.** 150ms or less on high-frequency hover/colour changes. Name exact properties
(`transition-[opacity,background-color]`), never `transition-all`. `scale-[0.96]` on press if
you use press feedback. Every animated state change also needs a static cue.

**Writing.** Verb-first buttons ("Open Zotero", not "OK"). Sentence case everywhere. Errors
and conditions say what happened *and* the next action. Address the reader as "you". No
"oops", no exclamation marks, no assembled sentences around a variable. Empty states orient
and point forward. Never name a system object the researcher doesn't have a word for — say
"your Zotero library", not "the local API"; say "this paper", not "the item".

**Access.** Visible focus (`focus-visible:ring-2 focus-visible:ring-accent`), 24px minimum
hit targets, real `<button>` for anything clickable, `aria-pressed` on toggles.

## Anti-patterns that will sink your variant

- A **card in a pane**: a result wrapped in a second bordered, padded container. The pane is
  the surface.
- A **select stack**: controls eating the space between the pane top and the list.
- A **setting as status**: a permanent line that just repeats a setting. Show a notice only
  for an active condition and its next action.
- A **wrong-cause sentence**: one message covering waiting, empty and failure.
- **CSS `columns`** for the list — it destroys page order. Use grid if you go multi-column.
- The generated look: `rounded-lg` on everything, an accent bar down the side of every card,
  everything centred, emoji.
