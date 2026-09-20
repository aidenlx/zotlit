# Round 2 — refining the winning variant

Round 1 offered three shapes for ZotLit's Zotero annotation view. The user picked **B**:
a masthead the pane speaks from, controls labelled in words, and cards whose page chip fuses
the annotation's location with its highlight colour.

Your starting point is **`/tmp/zotlit-annot-proto/round1/variant-B.jsx`** — the winning file.
Read it in full and keep its structure. You are making two changes, one of them shared by all
three round-2 variants and one that is yours alone.

Also read, as in round 1:
- `/tmp/zotlit-annot-proto/CONTRACT.md` — the design question, the hard contract, the craft rules
- `/tmp/zotlit-annot-proto/prototype-annot-view.html` — the import contract and shared store

Everything in CONTRACT.md still binds: token-only colour, `font-quote` on the excerpt alone,
logical properties, verb-first sentence-case copy, visible focus, 24px hit targets, no
`transition-all`, no Tailwind stock palette.

---

## Change 1 — shared by all three variants: the colour filter shows dots

Today B's colour control carries its state as text: `Colour ▾` at rest, and something like
`Yellow, green ▾` when filtering. Replace the text state with the colours themselves.

- **At rest:** a palette glyph, the word `Colour`, and a chevron. Unchanged.
- **Filtering:** the word disappears and the control shows the **selected colour dots** in the
  order they appear in the document, then the chevron. No text, no count, no "+2".
- Dots are the pure Zotero hex, ~8px, on the control's own surface. They need a hairline ring
  in `color-mix(in oklab, var(--ink) 15%, transparent)` so yellow does not vanish against a
  light control and grey does not vanish against a dark one.
- The accessible name still says it in words — `aria-label="Filtered to yellow and green"` —
  so nothing about this depends on sight or on hovering.
- Keep `Tags ▾` and `Search` exactly as B has them.

---

## Change 2 — the read-only treatment, which is what round 2 is actually asking

The user's words: *"we need no strong hint for need edit, should not interrupt readonly view
with a callout, need alternative ux."*

**Delete B's amber notice block entirely.** The thing that pushed the list down is gone.

And take the reframe that follows from it, which binds all three variants:

> When Zotero is closed, **reading is the normal mode**, not a broken one. ZotLit reads a
> saved copy and that is a perfectly good thing to be doing. Read-only is therefore **a mode,
> not a fault** — so it gets neutral chrome, never the semantic amber (`text-notice`,
> `bg-notice-soft`), never an alert icon, never a filled button competing with the content.

Consequences that apply to every round-2 variant:

- Nothing about the condition may push, cover, or reflow the list. The researcher scrolling
  their highlights must not be interrupted.
- The explanation must still be reachable **without hovering** — a tooltip is what round 1
  was fixing. Reaching it is a click or a keypress, and it must be keyboard-reachable with
  visible focus.
- At rest, the cost of the condition on screen should be close to nothing.
- `scenario: "saving"` and `scenario: "no-match"` behave exactly as B already has them.
- **`no-item` is the exception and does not change.** With nothing to read there is no reading
  to interrupt, so the pane body still states the real cause in full with its one action —
  keep B's treatment of it, but restyle it neutral to match (no amber).

How the card's editing verbs behave in `zotero-closed` is part of your treatment; each
variant below says what to do.

---

## Hard contract (unchanged from round 1)

- Exactly one paramless `function Variant<KEY>() { ... }`, wrapping itself in `<ObsidianFrame>`.
- **Every other top-level name prefixed with your variant letter.** All three variants are
  spliced into one module scope; you are starting from a file whose helpers are `B`-prefixed,
  so **rename every one of them** to your own letter or the three variants will collide.
- All state from `useProto()`. No props.
- Return only the absolute path to the file you wrote.
