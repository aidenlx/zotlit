# Round 5 — one trigger, one menu, and indicators that only indicate

> "unified, title header section being single trigger for one menu grouped to handle multiple
> actions, readonly and mode indicator only as an indicator, not as dedicated menu trigger"

The header has accumulated three separate press targets — the title block opens the mode menu,
`⌁ Reading only` opens the drawer, `📎 3 files` opens the suggester. Three targets sitting on
two lines at 12px, each with its own hover shape, its own focus ring and its own behaviour. For
a researcher that is three things to discover and three outcomes to predict.

Collapse it to one.

## The header section is a single button opening a single menu

- **The whole header is the trigger.** In the masthead shape that is the title *and* the byline
  together; in the status-bar shape it is the whole bar. One press target, one hover shape, one
  focus ring around the whole block, one chevron.
- **The indicators inside it stop being controls.** The mode phrase, `📎 3 files` and
  `⌁ Reading only` become plain inert text — no `<button>`, no `aria-pressed`, no hover shape,
  no focus stop of their own, no separate 24px target. They report state. That is all they do.
- **Every action lives in the one menu**, grouped, in this order:

```
Show annotations from
  ⧉  Active tab                    ✓
  📖  Zotero reader
  📌  Pinned
  ──────────────
  Pin this paper
  Choose a paper…                  → suggester over papers
  ──────────────
  Choose a file…                   → suggester over this paper's files
     <current file name>              (muted second line — the picker case)
  🔒  <current file name>              (the locked case: disabled, reason beneath)
  ──────────────
  Zotero isn’t open                   (informational, only while read-only)
  Open Zotero
```

Groups appear only when they have something to say: the file group follows `attachmentSlot(s)`
exactly as it does now, and the Zotero group appears only while `condition(s)` is non-null.

## What this changes from round 4

1. **`📎 3 files` no longer opens the suggester.** It is an indicator. The route to choosing a
   file is header → menu → `Choose a file…` → suggester. Keep the indicator itself exactly as
   it is; the user asked for it and it still answers the silent-menu-state problem.
2. **`⌁ Reading only` no longer opens the drawer.** It is an indicator. Someone who reads it and
   wants to know more presses the header and finds the Zotero group in the menu.
3. **The drawer stays, and keeps exactly one way in: a blocked card verb.** That route was the
   user's own decision two rounds ago — the explanation arriving beside the action that could
   not happen — and nothing here overrides it. Do not delete the drawer and do not add routes
   to it.
4. **`no-item` gets the same treatment.** There is no title there, but the quiet mode line above
   the empty message becomes the single trigger for the same menu, carrying the same chevron.

## Craft

- The accessible name of one big button has to carry what the eye gets from four fragments.
  Give the trigger a composed `aria-label` — the paper, the mode, the file count where shown,
  the read-only state, and that it opens a menu — rather than letting a screen reader run the
  visible fragments together into something shapeless.
- A whole-block button makes the paper's title unselectable. Say in your report whether that
  costs anything worth fixing; do not fix it unasked.
- The hover and focus shape now wraps two lines of text in the masthead shape. Check it does not
  read as a heavy slab — it should look like a target, not a card.
- Menu groups need their separators to carry meaning rather than decorate: three hairlines in a
  short menu is a lot. If a group is empty its separator goes with it.
- Everything else is unchanged: the colour-dot filter, `Tags ▾`, `Search`, the cards, the
  suggester, the empty states, `no-match`, `saving`, the drawer's internals.

## Verify

4 file cases × 5 scenarios × 3 modes × {340, 900} × {light, dark}. Zero console errors. Confirm
by query that the header contains exactly **one** focusable element in every combination, and
that no `[title]` attribute exists anywhere in it. Report the header's height in both shapes.
