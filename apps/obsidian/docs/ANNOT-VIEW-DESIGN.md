# Annotation View — design guide

## Scope and ownership

This guide governs the Obsidian Annotation View (`zotero-annotation-view`) — its chrome,
its states, its filtering, and the annotation cards themselves. It records visual judgment:
the reader's task, composition, hierarchy, density, disclosure, and wording.

Behavioral contracts, state machines and persistence belong in the relevant ADR, not here.
The authorization contract is
[ADR 0038](adr/0038-write-authorization-starts-only-from-a-user-gesture.md); reading
continuity is [ADR 0047](adr/0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md);
draft lifetime is [ADR 0048](adr/0048-annotation-drafts-and-pending-writes-stay-in-memory.md).
Shared brand rules live in [apps/docs/DESIGN.md](../../docs/DESIGN.md), and the sibling
guide for the Template Workbench is
[apps/docs/WORKBENCH-DESIGN.md](../../docs/WORKBENCH-DESIGN.md).

The visual reference is `prototypes/annot-view-redesign.html` — a throwaway single-file
mock, not production code. Its head comment records every decision below in the order it
was taken, with the user's own words. Open it before changing anything this guide governs.

## Reader and job

A researcher who lives in Zotero and Obsidian and whose expertise is their research. They
do not know what a capability, a local API or an attachment key is, and they should never
have to. Name visible objects in their terms: papers, files, highlights, comments, tags.

Their loop is: find the highlight they made, and use it in a note. Everything the pane
shows is either that highlight or a reason it cannot be reached.

## What this redesign corrected

The pane these rules replace failed in six ways. Each is now a rule below, and each is a
thing to check for in review.

1. **The pane's real news lived in a hover tooltip.** With Zotero closed, the only place
   that said so was a black tooltip — three lines of body text — covering the whole pane.
2. **The visible copy named the wrong cause.** The pane said "Open a literature note or a
   Zotero PDF to see annotations" while the actual blocker was that Zotero was closed. The
   reader followed the instruction and nothing changed.
3. **A secondary control outshouted the content.** *Enable editing* was a filled text button
   in a toolbar of icon buttons, the heaviest thing on screen, above a centred grey message
   with no next action.
4. **Seven rows of chrome could stack above the list** — toolbar, item title, attachment
   picker, condition lines, search row, filter bar, tag panel.
5. **One type size carried everything.** The whole pane was 12px, including the excerpt,
   which ran `leading-tight` under a three-line clamp.
6. **CSS `columns` destroyed page order.** Multi-column masonry reads down column one then
   down column two, so annotations left document sequence as soon as the pane widened.

## The shape of the pane

The pane is at most **two rows of chrome and then the list**. Everything else — the paper,
the mode, the file, the connection — is folded into those two rows or into the menu behind
them.

### One header, one menu

The header section is a **single press target opening a single grouped menu**. In the
masthead shape that target is the title and the byline together; in the status-bar shape it
is the whole bar. One hover shape, one focus ring, one chevron.

The chevron belongs to the block, not to any word in it: trailing edge, optically centred
against the whole section, with a reserved inline-end lane so no wrapped byline segment can
run under it.

Everything the pane can do that is not filtering lives in that one menu, grouped, with each
group appearing only when it has something to say and taking its separator with it when it
does not:

```
Show annotations from
  Active tab · Zotero reader · Pinned          (check on the one in force)
  ──
  Pin this paper · Choose a paper…
  ──
  Choose a file…                               (only when the choice is the reader's)
  ──
  Zotero isn't open · Open Zotero              (only while editing is unavailable)
```

Reporting rows — a locked file, a connection state — are `aria-disabled` and are stepped
over by arrow keys. They are there to be read, not to be chosen.

### Indicators indicate

The mode, the file count and the read-only state are **inert text inside the trigger**. They
are not buttons, they carry no hover shape, they take no focus stop of their own. A reader
who wants to act on what an indicator reports presses the header and finds the action in the
menu.

This is what keeps the header one target instead of four. Every indicator that becomes a
control costs a hover shape, a focus stop and a prediction the reader has to make.

### When the pane names the paper

The title and creators appear **only where nothing else on screen names the paper**. While
the view follows the active tab, the note or PDF in front of the reader already says which
paper it is; repeating it is a heading echo. This is `identityLabel()` in `presentation.ts`.

Because the title is also the menu trigger, losing it changes the pane's shape rather than
dropping a line:

| | Following the active tab | Pinned, or following the Zotero reader |
| --- | --- | --- |
| Shape | One status bar | Title and byline |
| Mode | Named in full — `Following the active tab` | The mode's **glyph alone**, before the title |
| Section height at 340px | 36px, flat in every file case and scenario | 47.4–47.6px, byline on one line in every combination |

The status bar keeps the mode phrase in words because it has no title to carry a glyph. The
masthead spends that width on the paper instead, and the accessible name names the mode in
words in both shapes — the glyph is an economy for the eye, never for a screen reader.

Byline segments carry **trailing** separators with the last one suppressed, computed from a
filtered array. A separator can never begin a wrapped line.

### The control row

Three controls, labelled in words a researcher can read without hovering: `Colour`, `Tags`,
`Search`. Their active states are **bounded**, so the row stops growing as selection piles
up:

- Colour draws at most **three** 8px squares, then a trailing `+n` counting what is hidden.
  Measured: 42 → 54 → 66px for one to three colours, then flat at 88px through all eight.
- Tags draw at most **one** name, then the same `+n`.
- `+n` is part of the control's label, not a second press target.

The visual cap never reaches the accessible name. With three squares and `+5` drawn, the
label still reads "Filtered to yellow, blue, green, purple, red, orange, gray and magenta".
A screen reader has no width constraint and is not given the summary.

Zotero's highlight palette is **data, not theme**. It rides in a custom property and is
never recoloured by the scheme. Every swatch carries a hairline contrast ring, or yellow
disappears on a light surface and grey on a dark one.

### The list

One annotation is a card on a `raised` surface with no border and no internal divider rules,
separated from its neighbours by space. The colour and the location are **one mark**: a page
chip tinted with the highlight colour, carrying a solid dot of the pure colour.

Multi-column uses **`grid`**, never `columns` — `grid-cols-2` at 500px and `grid-cols-3` at
860px, filling row-major so page order still reads leading-to-trailing, top-to-bottom.

## State the pane must speak

### Reading is the normal mode

When Zotero is closed, ZotLit reads a saved copy and that is a perfectly good thing to be
doing. **Read-only is a mode, not a fault.** It therefore gets neutral chrome: never the
semantic amber, never an alert glyph, never a filled button competing with the content, and
**never a callout that pushes the list down**.

At rest the condition costs two words in the header. Nothing about it may reflow, cover, or
interrupt a reader scrolling their own highlights.

### An empty pane is about the mode, not the connection

Two facts are independent and must never be fused:

- **Is Zotero running** decides whether a *write* can happen. It never explains an empty
  pane and must not appear in one.
- **Is a paper resolved** decides whether there is anything to *show*. What resolves a paper
  is the Follow Mode, so an empty pane is explained by the mode.

So the empty state names what the current mode is waiting for — "Open a literature note, or
a Zotero PDF, to see its annotations" / "Open a paper in the Zotero reader…" / "Pin a paper
to keep its annotations here while you write" — and the words "Zotero isn't open" cannot
appear there at all. A no-match state is about the filter and nothing else.

### Where an explanation lives

Never in a tooltip. An explanation is reached by a press and is keyboard-reachable.

There are exactly two surfaces, and each sits where its reader already is:

| Route | Surface |
| --- | --- |
| The reader sees `Reading only` and wants to know more | The menu's Zotero group — a label and `Open Zotero` |
| The reader presses a colour or comment verb that cannot act | The drawer at the pane's bottom edge, over the list, never reflowing it |

The drawer has exactly one way in: a blocked card verb. The explanation arrives beside the
action that could not happen.

A menu holds a label and an action; it cannot hold prose. With an explanatory sentence in
its Zotero row, the fullest menu ran 17–18px past the pane's bottom edge at 340px and would
have clipped `Open Zotero` behind `overflow-hidden`. The sentence lives in the drawer.

## The file choice

A control that offers no choice is chrome the pane cannot afford, so **there is no inline
file picker**. What the pane shows follows `attachmentLine()` in `presentation.ts`:

| Situation | The menu | The header |
| --- | --- | --- |
| One file | No entry | Nothing |
| An Obsidian PDF is open | No entry — that view already names the file | Nothing |
| The Zotero reader holds the choice | A disabled entry naming the file, with the reason as visible text | Nothing — no alternative is available, and saying otherwise would be a lie |
| Several files, the choice is the reader's | `Choose a file…`, opening a suggester | A quiet `3 files` indicator |

The indicator exists so that moving the choice into a menu does not leave the pane silent
about which file it reads. It reports; it does not open anything.

Choosing a file uses a **suggester**, Obsidian's native pattern for picking from a list, in
parallel with `Choose a paper…`. Long file names **wrap** rather than truncate there — it is
the one surface whose entire job is telling two similar names apart, so it spends the height.

## Type, density and wording

Chrome is Inter in sentence case, 12px, with 11px tracked micro-labels. Nothing goes below
11px.

The **excerpt wears the paper's face, not the app's** — it is a quotation lifted out of a
document, so it takes the reading font (`--font-text`) at 14px with a unitless 1.5 line
height. That one substitution gives each card hierarchy with no size jump and stops the
excerpt and the researcher's own comment reading as one voice at one size.

The **comment is the researcher's own words and outranks the source's**: full `text-ink`
body at 13px, not muted.

Any text that wraps to three or more lines needs at least 1.4 line height, clamp or no
clamp. Page numbers and counts take `tabular-nums`.

Buttons and menu items start with an outcome verb. Conditions say what happened *and* the
next action. Address the reader as "you". Never name a system object the reader has no word
for: say "your Zotero library", not "the local API"; "this paper", not "the item".

## Adaptation

Design for the ~340px right dock first; everything must survive there before it earns room
at width. Use container queries and native container selectors, never viewport state in
JavaScript.

Text containers carry no fixed width or height, rows wrap rather than truncate, and no
label is ever clipped away without a trace. Logical properties throughout.

## Recognisable design failures

- **Reason in a tooltip:** the only statement of a condition is on hover. The pane must say
  it, or a press must reach it.
- **Wrong-cause sentence:** one message covering waiting, empty and failure. State the
  actual cause.
- **Read-only as an error:** amber, an alert glyph, or a callout that pushes the list for a
  mode that is working exactly as intended.
- **Select stack:** controls eating the space between the pane top and the list.
- **Indicator as control:** a status that also opens something, adding a hover shape, a
  focus stop and a prediction.
- **Silent menu state:** a menu-only setting with no visible outcome in content.
- **Unbounded active state:** a filter control that grows with every selection.
- **`columns` for the list:** destroys page order the moment the pane widens.
- **One type size:** excerpt, comment and chrome sharing a size and a voice.
- **Prose in a menu:** a sentence in a menu row, which cannot hold it and will clip.

## Open questions

Recorded, not settled. Each needs a decision before this becomes production code.

1. **Square or round swatches.** The filter trigger draws colour as a square; the colour
   menu's own option rows and the card's page chip still draw it as a circle. The same
   colour is two shapes within one control. Unify, or scope "square" to the trigger.
2. **The title is unselectable.** The whole-block trigger overlays it, so the paper's title
   can no longer be dragged over and copied. Cheap in the prototype's judgment; confirm.
3. **The header's hover shape shares the card fill.** Both are `raised`, so a hovered header
   and the cards beneath it share one tone. A hairline ring would separate them.
4. **Zotero's native approval dialog is unverified end to end** — Allow, Always Allow, Deny,
   one-time consumption, and close/Escape semantics. Carried over from the prior handoff.

## Review loop

Review the reader's task before styling details: can a researcher find a highlight, use it
in a note, and understand why they cannot edit — without losing their place or hovering
anything?

Cover normal, loading, empty, no-match, saving and read-only, across all three modes and all
four file situations, at 340px and at width, in both schemes. The prototype's switcher drives
every one of those combinations; its sweep is 4 file cases × 5 scenarios × 3 modes × 2 widths
× 2 schemes.

Three assertions are cheap and catch most regressions:

- the header section contains **exactly one** focusable element,
- there is **no `[title]` attribute** anywhere in the header,
- **nothing overflows** the pane box.

Record accepted corrections here as observable sentences. Put a judgment in this guide, a
reusable mechanism in the components, and a repeatable failure in a deterministic check.
