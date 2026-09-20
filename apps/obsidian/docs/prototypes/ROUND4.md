# Round 4 — two changes to the top of the pane

Variant A won. Both changes below land on the masthead, so they are one piece of work.

> "when in title & author hidden case, top bar would act as status bar"
>
> "for attachment selector: simplify, include in one of option in menu, menu item trigger
> suggester for attachment selection instead of inline select"

---

## Change 1 — the masthead collapses to a status bar when the paper is already named

The store has a new helper:

```js
identityShown(s)   // false while s.mode === "active-tab"
```

It mirrors `identityLabel()` in `apps/obsidian/src/views/annot-view/presentation.ts`: the title
and creators are shown **only where nothing else on screen names the paper**, so never while
following the active tab — the note or PDF in front of the reader already says which paper it
is, and repeating it is a heading echo.

This variant's twist: **the title IS the Follow Mode control**, so when the title goes it takes
the control with it. The top of the pane must therefore change shape, not just lose a line.

**`identityShown(s) === false`** — one status bar, ~28px, and then the control row:

```
⧉ Following the active tab ⌄ · ⌁ Reading only
[Colour ▾] [Tags ▾] [Search]
p. 78  …
```

- The mode phrase (`MODES[s.mode].source`) with its glyph and a chevron **is** the mode menu
  trigger — the same menu the title opens in the other modes, same keyboard contract, same
  entries. It is the leading element and it may truncate; it never wraps to two lines.
- The read-only hint keeps its place at the trailing end of the same line and stays a separate
  24px target.
- This bar is chrome, so it is visually subordinate to the list: 12px, `text-muted`, no fill at
  rest, a `bg-raised` shape on hover and focus-visible, a hairline `border-b border-line` if
  the list needs separating from it.

**`identityShown(s) === true`** — the masthead as it is today, unchanged: the title block as
the control with its chevron, and the byline carrying `MODES[s.mode].source` and the read-only
hint.

Measure and report the height of the pane's top in both cases; the status bar should save two
lines against the masthead.

---

## Change 2 — the attachment picker becomes a menu entry that opens a suggester

**Delete the inline attachment control from the masthead entirely.** No picker line, no locked
line, no row of its own in either shape. The masthead is title + byline, or the status bar.

It moves into the mode menu as one entry, beneath the paper gestures, after a hairline:

```
Show annotations from
  ⧉  Active tab                     ✓
  📖  Zotero reader
  📌  Pinned
  ────────────────
  Pin this paper
  Choose a paper…                   → suggester over papers
  ────────────────
  Choose a file…                    → suggester over this paper's files
```

"Choose a paper…" and "Choose a file…" are deliberately parallel: both name a choice, both open
a suggester. Which paper, then which file of it.

**When the entry appears** is still `attachmentSlot(s)`, which is unchanged — you are moving
where its answer is rendered, not what it decides:

| `attachmentSlot(s).kind` | In the menu |
| --- | --- |
| `picker` (several files) | `Choose a file…`, enabled, opening the suggester. Carry the current file's name as a muted trailing label so the menu states the outcome rather than hiding it. |
| `hidden` (one file, or an Obsidian PDF is open) | **No entry at all.** There is no choice to make. |
| `locked` (the Zotero reader holds the choice) | An entry naming the current file, **disabled**, carrying `attachmentSlot(s).reason` — "The Zotero reader chooses this file" — as visible text, your choice of presentation. It must be readable without hovering: no `title`, no tooltip, ever. That is the exact failure this redesign started from. |

**The suggester** is Obsidian's native pattern for choosing from a list, so mock it as one: a
centred overlay over the pane with a text input at the top and the matching files beneath it,
each showing its name and its annotation count. Filter as the reader types. Arrow keys move,
Enter picks and sets `attachmentKey`, Escape closes and returns focus to the menu entry that
opened it. Style it with the prototype's tokens, in the shape of Obsidian's prompt: a raised
surface, a soft shadow, the input at the top, one highlighted row.

Long file names are the real test — "Braun and Clarke - 2006 - Using thematic analysis in
psychology.pdf" at 340px. They must stay readable in the suggester rows rather than being cut
to nothing; wrap or middle-truncate, your judgement, but say which you chose.

---

## Change 3 — a status saying another file is available

Moving the picker into the menu would leave the pane silent about which file it is reading —
WORKBENCH-DESIGN's "silent menu state" failure. The user has answered it: **show a status that
an alternative file is available.** So the choice keeps a presence in content; only the act of
choosing moves into the menu and the suggester.

- **Where.** One quiet segment on whichever line the pane's top is currently using — the byline
  when `identityShown(s)`, the status bar when not. It sits between the mode phrase and the
  read-only hint, in the same 12px `text-muted` chrome, with a paperclip-style glyph so it
  cannot be misread as a count of annotations.
- **What it says.** That there is another file to be looking at, not merely how many exist.
  `3 files` with the glyph, or `2 other files` — pick whichever reads plainest to a researcher
  who has never thought about attachments, and say which you chose. Keep it short; this line
  already carries the mode and sometimes the read-only hint.
- **What it does.** It is a `<button>` and it opens the **suggester directly**, not the menu —
  the status names a choice, so pressing it should make that choice. The menu entry stays as
  the second route in.
- **When it appears.** Only for `attachmentSlot(s).kind === "picker"`. Not for `hidden`, where
  there is nothing to choose, and **not for `locked`** — the Zotero reader holds the choice, so
  no alternative is actually available and saying otherwise would be a lie. `locked` keeps only
  its disabled menu entry carrying the reason.
- At 340px this line can now hold the mode phrase, this status and the read-only hint at once.
  Measure that case. The mode phrase truncates before this status disappears; nothing may be
  clipped away with no trace.

## Everything else is unchanged

Title-as-control and its menu, the mode phrase, the read-only hint, the one bottom drawer, the
colour-dot filter, `Tags ▾`, `Search`, the cards, the empty states, `no-match`, `saving`.

Verify: 4 file cases × 5 scenarios × 3 modes at 340 and 900, light and dark. Zero console
errors. Return only the absolute path to the file you wrote.
