# Brief: ZotLit landing page prototype, round 3 (combine A and D)

Round 2 built five variants for "An integrated research desk for Obsidian". The user looked at
all five and said: **"i like A and D, explore how they can be combined."** You build ONE
combined variant. Two other people build the other combinations in parallel. The switcher
shows the variants in this order, from more A to more D, so the user compares a spectrum:

```
A Exploded view  ─  F Desk to window  ─  G Drawing set  ─  H Desk explorer  ─  D The desk from above
(round 2)           more A               half and half     more D              (round 2)
```

Folder (all paths absolute):
`/Users/aidenlx/worktrees/zotlit-v2/proto-landing-page/apps/docs/.scratch/prototype-desk/`

## Read first

1. `BRIEF.md` in the folder: the round-2 brief. Its sections **The readers**, **The story**,
   **Coverage rules**, **Clean rules**, **The file contract**, **Styling rules**, **Copy
   rules** and **Verify in the browser** all apply to you unchanged, with the changes listed
   under "File contract for round 3" below. Its section "The five variants" is replaced by
   this brief.
2. `STORY.md` in the folder: the checked facts, the order of the eight jobs, the 40 features.
3. Look at the two originals in a browser before you design (same verification commands as in
   `BRIEF.md`): assemble a copy of `base-ad.html` with `variant-A.jsx` and `variant-D.jsx`,
   open `#A` and `#D`, and scroll through each at 1440×900 and at 390×844. Also look at
   `shot-A-desktop.png` and `shot-D-desktop.png`.
4. Read `variant-A.jsx` and `variant-D.jsx`. You will reuse parts of them.

## What the user liked (keep these)

From **A · Exploded view**:

- Integration made visible: the desk's layers (Zotero library, Library View, PDF reader,
  literature note, manuscript, citation graph) float apart as thin isometric panels with
  numbered orange leader callouts, and lock into ONE Obsidian window as you scroll. This is
  the proof of the word "integrated".
- The technical-drawing language: drafting grid, thin line work, mono callout labels, a title
  block, numbered parts.
- One section per job: the layer face-on as a working demo, with a **Parts list** (bill of
  materials) of all that job's features beside it. This covers all 40 features quietly.
- Strong demos you can reuse: Cite (style switcher, Citation Popover, "What you type"),
  graph synced with the References Sidebar, query table with reading status, Library View
  with the Reading Card, PDF reader with its toolbar, the "machine room" for the advanced
  features, install steps as assembly instructions with a specifications table.

From **D · The desk from above**:

- A real desk that an academic recognises at once. Each object stands for one research job:
  file box (Bring your library), books with a magnifier (Find a paper), open paper with a
  highlighter (Read and annotate), notebook (Take literature notes), manuscript on a
  clipboard (Cite while you write), pinboard with string (See how your sources connect), out
  tray (Export and submit), laptop with a toolbox (Make it yours).
- Select an object to see what it does for your research. Calm, with one quiet idle
  animation. The yellow highlighter mark on "research desk" in the H1.
- The plain list "Everything on the desk", the "Three things you will notice first" row for
  the signature features, and the "Set up your desk" cards.

## What to fix in the combination

- A: the scroll assembly ran only at 1024 px and wider with motion on. Phones saw a static
  fallback. The tiny UI inside the isometric panels is hard to read, so each layer's meaning
  depends on its callout.
- D: at 1440×900 the lower half of the desk is below the fold. The side panel does not lock
  page scroll. The demos are cramped inside the panel.
- Both: keep the page clean (one focal point per screen, at most one loop visible at a
  time). A combination tempts you to stack two concepts' worth of decoration. Choose.

## The three combinations (build only yours)

### F · Desk to window (more A)

A's structure, told with D's objects.

- **Hero.** H1, one supporting line, actions and requirements on one side. On the other, the
  desk with its eight objects, drawn in A's isometric projection on a desk plate, with A's
  numbered leader callouts (01 to 08, job name plus object name). Friendly objects, technical
  labels.
- **The one orchestrated moment** (sticky, scroll driven): the objects lift off the desk and
  each turns into its app layer (file box to Zotero library, books to Library View, open
  paper to PDF reader, notebook to literature note, manuscript to the editor with live
  citations, pinboard to the graph; the out tray and the laptop can stay on the desk, or
  become the export dialog and the workbench). A crossfade from object art to pane on each
  rising plate is enough. The layers then lock into one Obsidian window: "Everything on your
  desk, in one window." This moment must work on phones too (a shorter scroll and a narrower
  stack). With motion paused, show the three states (desk, exploded, window) as a static
  sequence.
- **Then the eight jobs, in order**, as in A: each section opens with its small flat desk
  object beside the job name, then the face-on working demo and the parts list. "Make it
  yours" is the machine room under the desk.
- **Then** install as assembly instructions, the specifications (needs, optional add-ons,
  privacy, licence), footer.

### G · Drawing set (half and half)

The page is a set of architect's drawings of D's desk.

- **Sheet 1, the plan (hero).** D's top-down desk redrawn as a clean technical plan in A's
  line language: thin ink strokes, light flat fills, the drafting grid, a numbered circle tag
  (01 to 08) on each object, a title block ("Sheet 1 · Plan · Research desk"). The H1 and the
  WHOLE plan fit above the fold at 1440×900 (H1 beside the plan, or a compact plan under a
  short H1). Hover or focus on an object shows its job name; selecting it scrolls to its
  detail sheet. Keyboard order follows 01 to 08.
- **A sticky key plan.** While the reader scrolls the sheets, a small copy of the plan stays
  in view (a corner on desktop, a slim strip of the eight numbered tags on phones). The
  current sheet's object is orange. Each tag jumps to its sheet. It never covers content.
- **Eight detail sheets, in JOBS order.** Each has a title strip ("Detail 03 · Open paper ·
  Read and annotate"), the outcome line, and ONE focal working demo drawn face-on. G's own
  idea: **the demo is the detail drawing.** The parts list is numbered, and the same numbers
  sit as small tags with leader lines on the demo UI where each feature lives (the Citation
  Popover tag points at the popover, the Copy bibliography tag at its button). A feature
  with no place in the demo keeps its number in the list only. Hovering a part in the list
  highlights its tag. The signature sheets (Cite, Connect) are visibly larger. Advanced
  features carry a "For power users" tag on their sheet.
- **Last sheet, assembly.** The three install steps as assembly drawings, the
  specifications (needs, optional add-ons, privacy, licence), footer.

### H · Desk explorer (more D)

D's structure; A's exploded view becomes what happens when you pick up an object.

- **Hero.** The H1 (with D's highlighter mark), the supporting line, the actions and the
  requirements, and D's flat illustrated desk. The WHOLE desk is visible at 1440×900
  together with the H1 and the actions (a smaller desk, or the text beside it).
- **Pick up an object.** Selecting an object opens an in-page stage in place of the desk (in
  the page flow, not a modal or side panel, so the page scroll stays free). The object
  lifts, and its job explodes into A's isometric stack: three to six thin layers, one per
  feature, each with a leader callout (feature name, `sinceLabel`). After a beat, the lead
  feature's layer turns face-on and grows into the full working demo; the other features
  stay as a callout list beside it. "Back to the desk" (and Esc) returns, with focus on the
  object. Previous and next move between objects in JOBS order. With motion paused, the
  stage shows the face-on demo and the list at once.
- **Below the desk:** "Three things you will notice first" (Citations in Live Preview,
  Citation Popover, Citations in the graph view) as large face-on demos, then "Everything on
  the desk" (the plain list, the keyboard and screen-reader path), then "Set up your desk"
  (the three install steps drawn as small A-style assembly drawings, needs, add-ons,
  privacy, licence), footer.

## File contract for round 3

Where `BRIEF.md` says otherwise, this wins:

- The base is `base-ad.html` (not `base.html`). Its head holds the design-plan comment and
  the token block for your key (F, G or H). The shared region is the same as round 2.
- Write exactly one file: `variant-<KEY>.jsx`, with one paramless `function Variant<KEY>()`.
- **Reuse by copying.** Copy any art, demo, hook or helper from `variant-A.jsx` or
  `variant-D.jsx` into your file, then rename every top-level name to your prefix (`A_Bom`
  to `F_Bom`, `D_ArtNotebook` to `H_ArtNotebook`, `aBBox` to `fBBox`) and re-scope its CSS
  (`[data-v="A"]` to `[data-v="F"]`, keyframe `a-pulse` to `f-pulse`). Your file must not
  call any name defined in `variant-A.jsx` or `variant-D.jsx`: the user may later keep your
  variant alone. Rename with care: a blind text replace also hits strings and class names.
- **Verify with the neighbours in place.** Each time:
  1. `cp <folder>/base-ad.html <folder>/test-<KEY>.html`
  2. `python3 /Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/prototype/assemble.py <folder>/test-<KEY>.html <folder>/variant-A.jsx <folder>/variant-D.jsx <folder>/variant-<KEY>.jsx`

  A duplicate top-level name then fails in your test as it would in the final file. Open
  `file://<folder>/test-<KEY>.html#<KEY>` with `--session proto-ad-<KEY>`.
- Check four views: 1440×900 and 390×844 in light mode, one dark-mode pass, and one pass
  with motion paused (the "Pause motion" button in the switcher bar). Test the scroll moment
  or the select interaction at both widths.
- Finish: keep `shot-<KEY>-desktop.png` and `shot-<KEY>-mobile.png` (top of page), delete
  `test-<KEY>.html` and other screenshots, close your browser session.

## Return

Only: the path of `variant-<KEY>.jsx`, and 3 to 5 lines: the concept, the section order, what
you took from A and from D, and anything that does not work yet. Keep the JSX out of your
reply.
