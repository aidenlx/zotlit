# Round 3 — the merged design, and the one control still open

Round 2 offered three places for the read-only condition to live. The user merged them and
raised a gap nobody had covered.

Their words:

> "B with A small readonly hint, but show a global drawer at bottom instead of per card
> callout. also, zotero not opened is not a reason for empty / no match, similify that. also,
> your design didn't cover mode switch."

Your starting point is **`/tmp/zotlit-annot-proto/round2/variant-B.jsx`** — round 2's "nothing
until you reach for it". Read it in full. Round 2's A is at `round2/variant-A.jsx` if you want
to see how its byline hint was built; you are reimplementing that idea, not copying the file.

Also read:
- `/tmp/zotlit-annot-proto/CONTRACT.md` — the design question and the craft rules, still binding
- `/tmp/zotlit-annot-proto/prototype-annot-view.html` — the import contract and the **rewritten store**

Everything in CONTRACT.md still binds: token-only colour, `font-quote` on the excerpt alone,
logical properties, verb-first sentence-case copy, visible focus, 24px hit targets, no
`transition-all`, no Tailwind stock palette, no amber — read-only is a mode, not a fault.

---

## The store changed. Read it before you write anything.

Round 2 fused two independent facts, which is why its empty state blamed Zotero. They are now
separate, and the separation is the point:

- **Is Zotero running** decides whether a **write** can happen. ZotLit reads the saved copy
  either way, so this **never explains an empty pane** and must never appear in one.
- **Is a paper resolved** decides whether there is anything to **show**. What resolves a paper
  is the **Follow Mode**, so an empty pane is explained by the mode.

New and changed exports:

```js
state.mode        // "active-tab" | "zotero-reader" | "pinned"
MODES             // { icon, label, source, empty, emptyAction } per mode
MODE_KEYS         // ["active-tab", "zotero-reader", "pinned"]
useProto().setMode(m)
canEdit(s)        // false only in "zotero-closed"
condition(s)      // null unless "zotero-closed"; { hint, title, body, action }
emptyState(s)     // { message, action } — what THIS MODE is waiting for
```

`condition(s).hint` is the short byline word ("Reading only"); `title` + `body` + `action` are
the drawer's contents. The switcher now has a **Mode** row, so all three modes are drivable in
every scenario.

---

## Changes 1–3: identical in all three variants. Build them the same way.

### 1. Read-only: a small hint in the byline, and ONE global drawer at the pane's bottom

- **The hint.** In `zotero-closed`, the masthead byline gains a quiet trailing element —
  `Braun & Clarke · 2006 · ⌁ Reading only` — neutral `text-muted` at the byline's own 12px,
  with a small `Unplug` glyph. No fill, no border, no amber. It is a `<button>`.
- **The drawer.** Round 2's per-card callout row is **deleted**. In its place, one drawer that
  slides up from the **pane's bottom edge**, over the list, never reflowing it. It holds
  `condition(s).title` (semibold, 13px), `condition(s).body` (13px, `text-pretty`), the
  `Open Zotero` action, and a close control. Neutral chrome: `bg-raised`, hairline
  `border-t border-line`, a soft upward shadow. Not a modal — the list stays readable and
  scrollable behind it.
- **Two ways in, one surface out.** Pressing the byline hint opens the drawer. Pressing a
  card's colour or comment verb while Zotero is closed opens the *same* drawer. There is
  exactly one explanation surface in the pane.
- **Closing.** The close control, Escape, or pressing the trigger again. Focus returns to
  whatever opened it. The drawer is not a tooltip and never opens on hover.
- **Card verbs**, as in round 2's B: the two write glyphs keep their exact position and size at
  a lower static rest opacity and do not brighten on hover. No padlock, no strike, no colour
  change. Nothing in the list explains itself.
- Transition the drawer with a named property (`translate` or `grid-template-rows`) at 150ms,
  and honour `prefers-reduced-motion`.

### 2. Empty and no-match: simplify, and never blame Zotero

- **`no-item`.** Render `emptyState(s)` and nothing else. The message names what the current
  mode is waiting for — "Open a literature note, or a Zotero PDF, to see its annotations." /
  "Open a paper in the Zotero reader…" / "Pin a paper to keep its annotations here while you
  write." plus its `action` where one exists. **The word "Zotero isn't open" must not appear
  in this state, and neither must the read-only hint or the drawer** — there is nothing on
  screen to edit, so there is nothing to explain. Round 2 had a whole neutral block with a
  glyph and a button here; make it lighter than that. A sentence and, where the mode has one,
  one action.
- **`no-match`.** About the filter and nothing else: one short sentence naming that nothing
  matches, and one exit that clears the filters. No Zotero, no mode, no count widget.
- Both sit in the pane's own flow near the top of the content area — not vertically centred,
  not grey-on-grey.

### 3. Do not regress round 2

Keep, unchanged: the masthead (title, byline, attachment picker), the control row with the
colour **dots** filter, `Tags ▾`, `Search`, the cards with the fused colour-and-page chip, the
comment sub-block, the tag chips, and the `saving` behaviour.

---

## Change 4 — the Follow Mode switch. This is what round 3 is actually asking.

The pane shows the annotations of one paper. **What decides which paper** is the Follow Mode,
and no round-2 variant offered any way to see or change it. It has three modes and two extra
gestures:

| Mode | Means | Extra gestures |
| --- | --- | --- |
| `active-tab` | Follows whatever note or PDF is in front of the user | — |
| `zotero-reader` | Follows the paper open in Zotero's reader | — |
| `pinned` | Holds one paper while the user writes elsewhere | "Pin this paper", "Choose a paper…" |

Requirements every variant shares:

- The mode in force must be **visible in the pane without opening anything**. A menu-only
  setting that leaves no visible outcome is the "silent menu state" failure.
- Changing it must be reachable by keyboard with visible focus.
- Menu entries are gestures, verb-first where they act ("Pin this paper", "Choose a paper…").
- It must not reintroduce a select stack — the pane had seven rows of chrome once already.
- At 340px it must not crowd out the paper's title or the three existing controls.
- `MODES[s.mode].source` is written for this ("Following the active tab" / "Following the
  Zotero reader" / "Pinned"); use it, or justify better wording.

**Your variant's treatment is given separately in your own brief.**

---

## Hard contract (unchanged)

- Exactly one paramless `function Variant<KEY>() { ... }`, wrapping itself in `<ObsidianFrame>`.
- **Every other top-level name prefixed with your variant letter.** You are starting from a
  file whose helpers are `B`-prefixed — rename every one, or the three variants collide in the
  shared module scope.
- All state from `useProto()`. No props.
- Verify all five scenarios **× all three modes** at 340 and 900, light and dark.
- Return only the absolute path to the file you wrote.
