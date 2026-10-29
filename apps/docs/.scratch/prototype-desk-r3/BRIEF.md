# Brief: ZotLit landing page prototype, round 3 ("the desk, inline")

You build ONE variant of a throwaway landing-page prototype for ZotLit, an Obsidian plugin
that brings a researcher's Zotero library (the reference manager) into Obsidian (the note
app). Three other people build the other variants in parallel. The user flips between the
variants with a bottom bar and picks a direction.

Folder (all paths absolute):
`/Users/aidenlx/worktrees/zotlit-v2/proto-landing-page/apps/docs/.scratch/prototype-desk-r3/`

## Where we are

Round 2 (`../prototype-desk/`) built five landing pages for the thesis **"An integrated
research desk for Obsidian."** The user's verdict, verbatim:

> i like concept of D, but it should not be popout, hard for user to explore, and "Three
> things you will notice first" is verbose, no need. i like how A lay out the features, but
> dont enforce the explore view. explore the alt design

- **D (liked concept):** a flat, top-down SVG drawing of an academic's desk. Each of eight
  objects stands for one research job (file box = Bring your library, books = Find a paper,
  open paper with highlighter = Read and annotate, notebook = Take literature notes,
  manuscript = Cite while you write, pinboard = See how your sources connect, out tray =
  Export and submit, toolbox and laptop = Make it yours). Selecting an object opened a
  side panel (bottom sheet on phones) with the job's demo and features. **Rejected: the
  pop-out panel**, and the "Three things you will notice first" section.
- **A (liked layout):** one section per job, in workflow order: a heading block (number,
  job name, one outcome line), then a face-on working demo on the left (7 of 12 columns)
  beside a **parts list** on the right (5 of 12): every feature of that job, one row each,
  with a filled dot on the features the demo shows working. A job with a wide demo puts the
  demo full width and the parts list in two columns under it. **Rejected: A's exploded
  view**, a pinned 340vh scroll sequence that the reader had to scroll through.
- Earlier, the user asked twice for a CLEAN page that non-technical academics understand,
  with the whole feature set covered, the basics included.

Look at both before you start (Read tool): `../prototype-desk/shot-D-desktop.png`,
`../prototype-desk/shot-D-mobile.png`, `../prototype-desk/shot-A-desktop.png`, and skim
`../prototype-desk/variant-D.jsx` (the desk) and `../prototype-desk/variant-A.jsx` from
`function A_JobHead` to `function A_Job`'s end (the section layout).

## The design question

**How does the desk lead the reader into the job sections, when everything is inline?**
All four variants use the same desk drawing, the same demos and the same parts list (the
kit, below), so they differ in STRUCTURE: where the desk sits, how it links to the
sections, how a section opens, and how the reader keeps their place.

## Hard rules (from the verdict)

1. **Inline only.** Every job's demo and parts list sits in the page and shows by plain
   scrolling. No side panel, modal, drawer, bottom sheet, overlay or popover for job
   content. No tabs, carousels or accordions that hide a job's content. Small UI inside a
   demo (the Citation Popover demo's own hover card) is fine: that is the feature.
2. **No highlights section.** No "Three things you will notice first", no separate
   signature or "why ZotLit" section. The signature demos (Citations in Live Preview, the
   Citation Popover, citations in the graph view) live in their own job sections, and the
   kit already puts them there.
3. **No forced sequence.** No pinned scroll sequence, no scroll-driven zoom or assembly of
   the desk, no scroll hijacking. The page scrolls like a document. A sticky element is fine
   when the content beside it scrolls normally.
4. **A's layout for each job:** heading block, then demo(s) beside the parts list on wide
   screens; demo, then the list on phones. Your structure can change the proportions or put
   a wide demo full width (with a two-column list under it), but the pair "working demo +
   complete parts list" is the unit of every job section.

## The kit (already in `base.html`, end of the `// --- Shared ---` region)

Round 2 variant D's code, renamed `D_` → `K_` and scoped under `[data-kit]`, plus round-3
helpers. Read the whole kit in `base.html` (search for `Round 3 desk kit`). Do not edit it;
if you need a different version of a kit component, copy it into your file under your
prefix (`B_Desk`).

- `K_Root({ v, className, children })`: your variant root. Sets `data-v`, `data-kit`,
  `data-motion`, renders the kit stylesheet (`K_CSS`), `bg-ground`, `font-body`, `pb-24`
  (room for the switcher bar). Use it as the outermost element.
- `K_Desk({ wide, layout, current, onPick, paused, labels, dimOthers, pickLabel })`: the
  whole desk drawing with one invisible `<button>` per object. `current` lifts and labels an
  object; `onPick(jobId)` fires on select; `labels`: `"hover"` (default), `"always"`,
  `"none"`; `dimOthers` fades the rest; `layout` forces `"wide"` (1600×860) or `"tall"`
  (800×1660, for phones). Its one idle loop (a highlighter on the open paper) runs while the
  desk crosses the middle of the viewport and `paused` is false: pass `paused` when a demo
  is playing at the same time (for example a sticky desk).
- Building blocks if you draw your own desk view: `K_OBJ` (each object's size, `Art`
  component, shadow, icon view box), `K_WIDE` / `K_TALL` (positions), `K_DeskTop`,
  `K_Mug`, the `K_Art*` components, `K_ObjIcon({ id, className })` (one object alone, any
  size: an icon or a large illustration).
- `K_JOB_DEMOS[jobId]`: the demos of each job, lead first: `{ id, Demo, shows, hint }`.
  cite has two (Citations in Live Preview, Citation Popover) and connections has two
  (citations in the graph view, References Sidebar); every other job has one.
- `K_LiveDemo({ Demo, paused })`: renders one demo in a size container and runs it only
  while it crosses the middle band of the viewport, so at most one loop plays at a time.
  `K_DemoCaption({ entry })`: "Shown: <feature> <badges>" plus the hint.
- `K_PartsList({ job, columns, label, extras, legend, shown })`: the parts list. All
  features of the job with name (linked to its docs page), badges (New in 2.2, Since 2.1,
  For power users, Experimental, Needs ZotLit Companion), the one-line description, a plain
  explanation for technical terms, and the small demos of Query files and blocks, ZotLit
  Query CLI and AI assistant skills inside their rows. This is how the page covers all 40
  features. Change `label` if your concept calls for it ("Parts list" was A's word).
- `K_HeroCopy({ id, size, className })`: the approved hero copy: H1 "An integrated
  research desk for Obsidian." (highlighter on "research desk"), the supporting line,
  Install ZotLit / Read the docs, the requirement line.
- `K_Header()`, `K_Setup()` ("Set up your desk": three install steps, what you need,
  optional add-ons, privacy, licence, actions; section id `k-setup`), `K_Footer()`,
  `K_LinkBtn`, `K_Badges`, `K_Icon({ name, size, className })`, `K_NUM(i)` ("01").
- `K_useSpy(ids, line = 0.4)`: the id of the element that crosses the line 40% down the
  viewport (scroll position tracking). `K_useMedia(query)`. `K_useBand(ref)`.
- `K_scrollTo(id, { smooth, block })`: scroll to an element and move focus to it. **Use it
  for every in-page link.** The variant switcher owns `location.hash`, so `href="#id"` links
  fight it. Pass `smooth: motion` (from `useProtoState()`).

`kit-smoke.jsx` in the folder is a 40-line smoke test that wires every kit part together
in the plainest way. It shows the API in use; it is not a design to copy.

Everything else in scope is listed in the `<head>` comment and the Shared region: React
hooks, `Icons.*` (lucide), `Motion.*`, `useProtoState`, `JOBS`, `FEATURES`, `featuresOf`,
`leadOf`, `feature`, `sinceLabel`, `TIERS`, `FACTS`, `INSTALL_STEPS`, `ADDONS`, the mock
library (`PAPERS`, `ANNOTATIONS`, `NOTES`, `DRAFT`, `GRAPH`...), `ZotLitMark`, `Lockup`,
`Wordmark`.

## Coverage (every variant)

- Header (the kit's or your own: lockup, Docs, Changelog, Community, GitHub with stars), the
  hero with the approved copy, all eight jobs in `JOBS` order, each with its demos and its
  complete parts list, the setup section, the footer.
- The desk appears in the hero. Every object on it leads to its job section.
- Keyboard and screen readers get the jobs in `JOBS` order.

## Clean rules

- One focal point per screen. Generous space. Little prose: a section has its heading, one
  outcome line and the demo; the parts list carries the detail.
- At most ONE looping animation visible at a time (use `K_LiveDemo`; pause the desk's idle
  loop when it shares the screen with a demo).
- No tickers, marquees, particles, noise, decorative blobs, glow, decorative gradients,
  emoji, fake numbers or invented quotes.
- Numbering (01 to 08) only for the jobs, which are a real sequence, and the install steps.

## The four variants (build only yours)

- **A · Desk as contents.** The hero desk is the contents page: it must read at a glance as
  "eight things, pick one" (for example numbered name tags always visible, or a numbered key
  beside the drawing; your call). Selecting an object scrolls to its section. When the hero
  desk leaves the screen, a slim bar sticks to the top of the viewport: the eight objects as
  small drawn icons (`K_ObjIcon`), with the current section marked (`K_useSpy`) and each one
  a jump link. Sections in A's layout under it. On phones the bar is a compact strip that
  never makes the page scroll sideways.
- **B · Desk at your side.** On wide screens (≥1024 px) the job sections run in a column
  beside a sticky desk column: the desk stays in view while you read, the object for the
  section in view lifts and the others dim, its name and "03 of 08" sit under it, and
  selecting another object jumps there. The section column is narrower, so each job stacks
  its demo above its parts list (two list columns when there is room). The sticky desk must
  stay calm: no idle loop while a demo plays. You may arrange a compact desk of your own
  from the kit's parts if the full desk is too small in the column. On phones: the desk once
  at the top, then the sections, each opening with its object icon.
- **C · Object chapters.** Nothing sticky. The hero desk is the map (select to jump). Each
  job section opens with a chapter opener: a band in the desk colour (`var(--k-desk)`) with
  that object lifted off the desk and drawn large (`K_ObjIcon` or the `Art` with its
  shadow), the job number, name and outcome. Then demo and parts list in A's layout on the
  plain page ground. The reader always sees which object a section belongs to. A quiet "Back
  to the desk" link per section is fine.
- **D · The page is the desk.** The desk surface continues down the whole page. The hero is
  the full desk seen from above; each job section below is a close-up of the same desk with
  that job's things laid out on it: the demo as a sheet or screen lying on the desk, the
  parts list printed on a card or notepad page beside it, the object itself in the scene.
  Text always sits on paper (`--surface`), never directly on the desk colour, except big
  headings. Physical, but calm and legible: the same flat drawing language as the desk (one
  1.5 px edge, flat offset shadows, small rounded corners), no texture, no skeuomorphic
  gloss. Selecting an object in the hero jumps to its close-up.

## The file contract

- Write exactly one file: `variant-<KEY>.jsx` in the folder: a paramless
  `function Variant<KEY>() { ... }` plus your helpers. Mock state from shared hooks or local
  `useState`, never props.
- All variants share ONE script scope. Prefix every top-level name you add with your key:
  `A_Bar`, `aOrder`. Never redeclare a shared or kit name.
- Do not edit `base.html`, `BRIEF.md`, the `build/` folder, another variant, or anything
  outside the folder. No git.
- Extra CSS: a `<style>` inside your root, selectors scoped under `[data-v="<KEY>"]`,
  keyframes prefixed with your key in lower case.

## Styling rules

- Colour and type only through the token utilities (`bg-ground`, `bg-surface`, `text-ink`,
  `text-muted`, `border-line`, `text-accent`, `bg-accent`, `text-accent2`, `text-cite`,
  `bg-z-yellow` and the other Zotero colours, `font-display`, `font-body`, `font-mono`) and
  the kit's CSS variables (`var(--k-desk)`, `var(--k-shadow)`, `var(--k-paper)`...). No
  stock Tailwind palette (`bg-white`, `text-gray-500`): it breaks the dark scheme. Opacity
  modifiers are fine.
- Check both colour schemes; the tokens switch with `prefers-color-scheme`.
- Motion: every loop freezes on a meaningful finished frame when `useProtoState().motion` is
  false (the kit's demos do). Smooth scrolling only when motion is on.
- 390 px wide: 16 px side gutters, no horizontal page scroll; a wide demo scales or scrolls
  inside its own box. 6rem free at the bottom for the switcher bar (`K_Root` adds it).
- Visible keyboard focus. Interactive things are `<button>` or `<a>`.

## Copy rules

- Sentence case. Short sentences. Active voice. Simple words. Research outcomes, not
  mechanisms. No marketing words ("supercharge", "seamless", "unlock", "effortless",
  "powerful", "elevate"), no em dashes in your own copy, no "not X, but Y". Feature names
  exactly as in `FEATURES`; no invented features, numbers or quotes. Keep your own copy to
  labels and a few short lines; the kit carries the feature text.

## Verify in the browser before you return

The browser is the only oracle: one JSX error blanks every variant. Use plain literal
commands with absolute paths. The session guard refuses shell variables, `$(...)`, loops
and any command that contains the word `eval`.

1. `cp <folder>/base.html <folder>/test-<KEY>.html`
2. `python3 /Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/prototype/assemble.py <folder>/test-<KEY>.html <folder>/variant-<KEY>.jsx`
   (re-copy base.html first each time).
3. Run `agent-browser skills get core` once. Pass `--session proto-r3-<KEY>` on every
   agent-browser command. `open file://<folder>/test-<KEY>.html#<KEY>`, then
   `wait --fn "document.getElementById('root').children.length > 0"`, then `console` and
   `errors`: both free of errors.
4. Screenshots at 1440×900 and 390×844: the top, and while scrolling through the whole page
   (a full-page capture is fine; crop it with
   `uv run --quiet --with pillow python3 -c "..."` to look at parts). Light mode, and dark
   mode once. Look at each with the Read tool. Click an object on the desk and check that
   the page lands on its section; for sticky parts, check them mid-page. Fix what is broken,
   overlapping, clipped, unreadable or cluttered, then look again.
5. Finish: keep `shot-<KEY>-desktop.png` and `shot-<KEY>-mobile.png` (top of page) and one
   mid-page desktop shot `shot-<KEY>-section.png` that shows how a job section opens. Delete
   `test-<KEY>.html` and other screenshots; close your browser session.

## Return

Only: the path of `variant-<KEY>.jsx`, and 3 to 5 lines: the structure, how the desk links
to the sections, and anything that does not work yet. Keep the JSX out of your reply.
