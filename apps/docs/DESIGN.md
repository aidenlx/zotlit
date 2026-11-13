# ZotLit docs site — design spec

Theme: **"Journal"** — warm paper ground, near-black ink, deep-orange accent.
One token system (`--color-fd-*` overrides in `src/styles.css`) drives all
surfaces: landing, changelog, blog, docs, `/learn`, and the Template Workbench.

Compose each surface around the reader's task. Editorial pages lead with
content; the Workbench gives space to editing and inspecting the result;
a lesson gives space to the one step the reader is doing.
Apply the shared brand rules together with the relevant per-surface section.
Use [the brand specification](../../docs/brand.md) for logo and wordmark assets.

Visual references: the landing at
`prototypes/landing-prototype/prototype-landing.html` on
`prototype/landing-desk` (see Landing), and
the `/learn` checklist at
`prototypes/learn-prototype/prototype-learn.html` on
`prototype/learn-tutorial` (variant D's course page and checklist).
Where this spec and a prototype differ, this spec wins.

## Key points

1. **An academic page, printed-journal calm.** Serif display, sans text, mono
   apparatus labels; figure-and-caption conventions ("Figure 1."); generous
   space; one focal point per screen.
2. **Show the work.** A feature appears working — in a recording of the real
   app or in a web replica of it — on real-looking research data. Prose stays
   to a heading, one outcome line and a caption (see Illustration).
3. **Shadows for elevation, hairlines for structure.** Raised surfaces take a
   1px shadow ring; section rules and dividers take `border-fd-border`.
4. **Quiet motion.** 150 ms state changes, at most one loop in view at a time.
   Reduced motion gets opacity fades or the final frame.
5. **Readable colour.** Ink and muted text pass 4.5:1 on every surface; small
   accent text uses the accent text tone.

## Mechanism

Every visual decision is expressed through Fumadocs' customization surface:
the `--color-fd-*` token set, layout props, and app-owned **layout slots**.
Ejected slots vendor only their own file; everything they import stays on
package entry points, so upstream maintains the primitives. Re-diff vendored
slots against upstream on fumadocs bumps.

(`fumadocs-ui` is aliased to `@fumadocs/base-ui`; its CSS/theming/layout
surface is identical, and the CLI's `base-ui` registry serves it first-class.)

Owned layout slots:

- `src/layouts/home/slots/header.tsx` — home nav: IBM Plex Mono uppercase links, double hairline.
- `src/layouts/docs/slots/sidebar.tsx` — docs sidebar: orange rubric on folder
  rows, muted small-caps `links`-prop entries, near-ink page links.
- `src/layouts/docs/page/slots/footer.tsx` — prev/next cards: muted direction
  label over the title. Exports `FooterCards` for reuse on blog posts.
- `src/components/docs-subnav.tsx` — mobile docs header with the hairline
  signature (`DocsLayout slots.header`).
- `src/components/banner.tsx` — vendored fumadocs `Banner`: `height` is a floor
  (`min-height`), so the strip wraps instead of overflowing on narrow
  viewports, and a resize-synced `--fd-banner-height` keeps sticky offsets
  tracking the wrapped height. Consumed by `src/components/legacy-banner.tsx`.

## Tokens

| Role | Light | Dark | Maps to |
| --- | --- | --- | --- |
| Ground (page) | `#f7f5f0` | `#121418` | `--color-fd-background` |
| Surface (cards, windows, popovers) | `#ffffff` | `#1b1e24` | `--color-fd-card`, `--color-fd-popover` |
| Ink (text) | `#1b2029` | `#e9e6df` | `--color-fd-foreground`, `--color-fd-card-foreground`, `--color-fd-popover-foreground`, `--color-fd-secondary-foreground`, `--color-fd-accent-foreground` |
| Muted (secondary text) | `#5f6672` | `#9b978f` | `--color-fd-muted-foreground` |
| Line (hairlines) | `#e3dfd6` | `#2d3037` | `--color-fd-border` |
| Accent text tone (accent text, accent fills that carry text) | `#b9461a` | `#f0793f` | `--color-fd-primary` |
| Text on the accent fill | `#ffffff` | `#121418` | `--color-fd-primary-foreground` |
| Accent (rings, dots, rules, large numerals) | `#e8622c` | `#f0793f` | `--color-fd-ring` |
| Quiet fill (hover rows, code, chips)¹ | `#f0ede6` | `#23262d` | `--color-fd-muted`, `--color-fd-secondary` |
| Warm tint (accent hover, notices)¹ | `#fbf1e6` | `#2a221d` | `--color-fd-accent` |
| Highlighter | Zotero yellow `#ffd400` at 48% | at 30% | one marked phrase per page |

¹ Derived for the Fumadocs token set: the light values come from the lesson
prototype's chip and fix-panel fills; the dark values are set to sit between
ground and surface and are measured below.

`--color-fd-primary` carries the accent text tone because Fumadocs and the
site set it as text (active links, the TOC, rubrics, links in notices) and
as the fill of the primary button. The brighter accent reaches 3.1:1 on the
light ground, so it marks rather than speaks: the focus ring, dots, rules and
large numerals, through `--color-fd-ring`. In dark the two are one colour.

Measured contrast (WCAG 2.x):

| Pair | Light | Dark |
| --- | --- | --- |
| Ink on ground | 15.0:1 | 14.8:1 |
| Ink on surface | 16.3:1 | 13.4:1 |
| Ink on quiet fill | 14.0:1 | 12.2:1 |
| Muted on ground | 5.3:1 | 6.3:1 |
| Muted on surface | 5.8:1 | 5.7:1 |
| Muted on quiet fill | 4.9:1 | 5.2:1 |
| Accent text on ground | 4.9:1 | 6.6:1 |
| Accent text on surface | 5.3:1 | 6.0:1 |
| Accent text on quiet fill | 4.5:1 (4.54) | 5.4:1 |
| Accent text on warm tint | 4.8:1 | 5.6:1 |
| Text on the accent fill | 5.3:1 (white) | 6.6:1 (ground) |
| Accent (ring) on ground | 3.1:1 | 6.6:1 |

The Zotero annotation colours (`--z-yellow`, `--z-red`, …) appear only where
they mean Zotero highlights: in recordings and inside the app windows on the
landing's desk.

The brand mark and wordmark keep their own inks, `--zotlit-ink` (navy) and
`--zotlit-accent`, from the brand specification; the theme tokens leave them
alone.

## Type system

Four faces, four roles:

| Face | Role |
| --- | --- |
| **Gelasio** (serif) | Content & display: headings, titles, descriptions/ledes/standfirsts, feature descriptions, editorial annotations |
| **Inter** (sans, unpreloaded) | Prose body & chrome: markdown running text, sidebar, TOC, buttons, search |
| **IBM Plex Mono** (weights 400/500/600, unpreloaded) | The **"Machine" voice**: code, version chips, numerals that count or order, meta lines, and every UPPERCASE apparatus label (home nav, landing labels, blog & changelog dates). Drives `--font-mono`. |
| **Archivo** (subset woff2) | Wordmark only — subset to exactly the "ZotLit" glyphs |

The Journal prototypes set Newsreader and Source Sans 3 in the serif and sans
roles; whether the site moves to those faces is an open owner decision.

Serif carries the editorial voice at **weight 500** for display headings and
**italic** for ledes/standfirsts. Sans carries the **markdown prose body** —
running paragraphs in docs, blog, and the changelog — whose display headings sit
in serif. Inter loads both upright and italic for true `<em>`s beside Gelasio's.
Numerals in tables, counters and step numbers use `tabular-nums`.

Serif is **opt-in**, not blanket-inherited: the app-wide default is sans, and
each editorial surface opts its display type into serif. Shared `_home` chrome
— nav, banner, search — stays sans/mono. A sans prose body inside a serif
surface stays sans; only its display headings take the serif.

The `ztProse` heading scale (`src/lib/prose.ts`) sits one notch above Fumadocs'
stock sizes to compensate for Gelasio's smaller x-height (~0.48em vs Inter's
~0.55em). Blockquotes at 1.125em put Gelasio at optical parity with the
surrounding sans body.

Apparatus marks come from Lucide or from text-presentation glyphs. Emoji-set
codepoints stay out: Apple platforms serve them from Apple Color Emoji through
font fallback, so a mark set in accent orange paints as a color emoji in Safari.
Lucide strokes track the text beside them: 1.5px beside regular text, 2.25px
beside semibold button text.

## The label voice

Apparatus **labels** — short text that names a thing rather than saying a
sentence — speak the **Machine register: IBM Plex Mono, `uppercase`**,
0.08–0.2em tracking, weight 500–600. Real uppercase over the bundled mono
stays legible at any size, including shrunk-down OG cards.

On editorial and docs-chrome surfaces, apparatus labels are mono uppercase:

- Home nav links
- The landing desk's tape labels and the `/learn` outcome label ("You end
  with")
- Changelog/blog dates and meta lines; version-ledger row labels
- Docs sidebar folder + `links`-prop rows, the TOC "On this page" title, docs
  prose h4, and the command `Copy →` affordance

Numerals that count or order — "02 / 05", "Step 1", "01" in a caption trail
— take the mono face in normal case, with the current or leading number in the
accent text tone. A `/learn` step number sits inside its title instead, so it
takes the title's sans face, regular and tabular (see Learn).

**The layout explains; a label appears only where position and grouping
cannot.** Before adding a label or a secondary description, check whether
the element's place, its group or the element itself already says it: a
row's number gives its order, the green band marks what the reader should
see, and the first, wider card is where to start. A screen reader that
cannot see the layout gets the name as `sr-only` text.

Docs-chrome labels ride the same voice at a smaller size (~0.72rem) and quieter
weight — micro-apparatus inside the sans body rather than marketing display, but
the same mono-uppercase register.

**Running prose stays in normal case**, even in chrome: full sentences read as
text, not labels — so the v2 banner notice, tooltips, figure captions, lesson
captions and check lines, and any sentence-shaped copy keep their upright case
and sans body voice. The Archivo wordmark likewise stays outside label
treatment.

The [Template Workbench](WORKBENCH-DESIGN.md) uses Inter sentence case
for its utility chrome, including labels and pane headings.

## Surfaces and elevation

- **Shadow ring.** A raised surface (card, recording frame, secondary
  button) takes `border: 1px solid transparent`
  under the layered ring, so forced-colors mode still draws an edge. The ring
  is a token pair in `src/styles.css`, reached as the `shadow-ring` and
  `shadow-ring-hover` utilities:
  - light: `0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06), 0 2px 4px 0 oklch(0 0 0 / 0.04)`;
    hover: the same layers at 0.08 / 0.08 / 0.06;
  - dark: `0 0 0 1px oklch(1 0 0 / 0.08)`; hover at 0.13.
- **Hairlines for structure.** Section rules, list dividers, table rows and
  card dividers use `border-fd-border`. A list head sits on a 1px ink rule.
- **Radii.** Buttons 10px; list rows and small controls 8px; cards, app
  windows, recordings and lesson pictures 10–14px. Where surfaces nest with an even
  inset, the outer radius is the inner radius plus the padding.
- **Buttons.** The kit's primary button (`src/components/ui/button.tsx`) fills
  with the accent text tone and carries the text-on-accent tone. On the
  landing and `/learn`, the leading action is 44px tall and sans semibold —
  the accent fill on the landing, ink fill with ground text on `/learn` — and
  the secondary action is the surface with the shadow ring (Target).
- **Toasts.** Transient feedback from `toast.add()` sits on the popover
  surface (`src/components/ui/toast.tsx`): a hairline border, a floating
  shadow, an ink title and a muted description.
- **The highlighter.** At most one phrase per page carries it: a 0.28em band
  of the highlighter colour at 88% of the line box, drawn as a background
  image so it wraps with the text.

## Motion

Values follow the `better-ui` skill.

- **State changes.** 150 ms ease-out on the properties that change — opacity,
  color, background-color, box-shadow — named one by one.
- **Press.** Buttons scale to 0.96 over 150 ms ease-out, under
  `prefers-reduced-motion: no-preference`, and stay still when disabled.
- **Hover.** Hover styling applies on hover-capable pointers only (Tailwind 4's
  `hover:` does this).
- **Colour-scheme switch.** Transitions are suspended for the swap and
  restored on the next frame.
- **Loops.** At most one loop plays in view at a time — a lesson recording, a
  landing recording or the landing's table demo: a recording runs while it
  crosses the middle band of the viewport, and the demo while half of it is
  on screen. A loop starts on its own only where the
  reader is already looking at it: a recording that shows an outcome rather
  than the step at hand (a lesson's result) rests on its poster with its
  play button until the reader plays it. Each loop rests elsewhere, and a loop that starts rests the one that
  played. A recording plays in the recording player, whose play button
  pauses it; a recording the reader paused holds the turn while it stays in
  view, so no other loop starts behind the pause. The table demo carries a
  visible pause button (WCAG 2.2.2).
  With reduced motion, a recording rests on its poster until the reader
  plays it, and the table demo shows its finished frame.
- **Scroll.** The page scrolls as a document, with no scroll-linked movement.
  The landing's desk drifts with the pointer only (see Landing).

## Illustration

A view explains before a paragraph does. Prefer a recording, a replica, a
map, a before/after pair or a small table over prose; keep the words to a
heading, one caption and one check line.

- **Lessons show recordings.** Each `/learn` step shows a short recording of
  the real app doing that step: about 3–8 seconds, looping, resting on the
  result. Reduced motion shows the last frame. The clip's final frame,
  framed on the result, is its poster; the step's screenshot stands in until
  a poster exists. The reader then does the step once,
  in their own Obsidian, so a lesson ends with a working setup on their own
  library.
- **The landing shows recordings and enacted windows.** Each workflow step
  shows a recording of the real app. The hero's desk and the table demo show
  small app windows built in HTML from the real app's labels and the open
  Lucide icons, on real-looking research data, inside a plain window frame of
  our own. Obsidian's own stylesheet and window chrome stay out.
- **The landing lets a visitor try one moment** (Target). Inside a window, a
  visitor tries a signature moment in about 20 seconds before any install,
  and the moment hands them to Install and Lesson 1. The first: type `[@` in
  a draft, pick a paper, and the formatted citation appears. Further
  candidates: drag a highlight into a draft so the quote arrives with its
  page; mark a paper "to-read" in the reading table.
- **The recording player.** Every recording on the site plays in one
  Video.js player (`src/components/recording-player.tsx`, composed from
  Video.js UI components), loaded on demand: the page prerenders the still,
  which stays until the player arrives. Its control bar floats 10px inside
  the frame's bottom edge: a pill on the surface with the shadow ring,
  holding a 36px round play/pause button, the seek bar (a 4px track in the
  muted tone at 70%, 3:1 on the surface; the fill and a 14px thumb in the
  accent through
  `--media-accent-color`, a 36px tall hit area, half-second arrow steps),
  the current and total time (mono 11px, muted, tabular; hidden when the
  player is under 18rem wide) and a 36px fullscreen button. The clips are
  silent, so there is no volume control. Lucide icons swap in place on the
  control's state. The bar shows while the clip is paused or the reader is
  active, and fades out over 150 ms during playback; keyboard focus brings
  it back. The player is a focusable group named by the recording's alt
  text; Space plays or pauses and the arrow keys seek while it has focus.
  A clip plays muted and looping while it crosses the middle of the
  viewport; a page can turn this off for a clip (`autoplay={false}`), which
  then rests on its poster, as under reduced motion, until the reader plays
  it. Once the reader plays or pauses a clip, the reader's choice holds.
  A clip rested by another loop while still in view plays again when that
  loop rests. In fullscreen the whole clip shows (`object-fit: contain`).
- **Words stay page text.** Captions, numbered-mark references and check lines
  are HTML beside the picture, so they translate, wrap and reach screen
  readers. The picture carries a text alternative that says what it shows.

The reader's path: search → landing (try one moment in the web) → Install →
`/learn` (watch a step, do it in your Obsidian).

## Font loading

Fontsource serves all four faces from the package's own assets: the `@import`s
at the top of `src/styles.css` register them, and the `@theme inline` block in
the same file assigns the roles. Metric-adjusted local fallback faces in that
stylesheet preserve the shift-free swaps that `next/font` generated before the
TanStack Start migration. The Inter and Gelasio overrides come from Next.js
16.3.0's metrics for these Google Font families. The mono fallback stands in
for a fixed-pitch face, so it names monospace locals instead of the
proportional Arial `next/font` emits for every family — a proportional stand-in
matches Plex Mono across mixed-case prose and then runs ~38% wide on the short
uppercase apparatus labels, which is where the swap moves the layout. Those
locals carry no `size-adjust`: every monospace face shares Plex Mono's 0.6em
advance, so the overrides pin the vertical metrics alone.

Gelasio's upright and italic latin faces preload in `src/routes/__root.tsx`
because serif display paints on essentially every route. Inter stays
unpreloaded because its adjusted fallback stabilizes the app-wide body and
chrome until the real face loads.

IBM Plex Mono loads three explicit weights (400/500/600 — Plex Mono isn't a
variable font), unpreloaded, swapping from its monospace local fallback.
Its `@theme inline` `--font-mono` override reroutes both the `font-mono` utility
and every `var(--font-mono)` reference onto it in one lever.

The Archivo wordmark subset needs no preload — it sits under Vite's
`assetsInlineLimit`, so the build inlines it into the stylesheet.

## Per-surface

### Template Workbench (`/workbench`)

Extracted to [WORKBENCH-DESIGN.md](WORKBENCH-DESIGN.md) — audience, layout,
control vocabulary, typography, responsive folds, and the enforcement table.

### Landing (`src/routes/_home/index.tsx`)

Built in `src/components/landing/`. Prototype:
`prototypes/landing-prototype/prototype-landing.html` on the
`prototype/landing-desk` branch; its top comment records the owner's
decisions round by round.

The landing tells one story: **"A research desk for Zotero in Obsidian."**
First the desk, then the research sequence from finding a paper to sending
the chapter to Word, then the reading table in detail. Five parts, top to
bottom: the hero, the workflow, "Compare your papers", the trust row and the
closing call. Sections run 1152px wide (`max-w-6xl`) with 32px side gutters
(16px on phones); each opens on a hairline.

- **Header and footer.** The shared home nav (see Owned layout slots) and
  the shared copyright footer.
- **Hero.** Centred text on a research desk. The H1 "A
  research desk for Zotero in Obsidian." (display, 2.6rem on phones, 3.75rem from 640px, at
  1.12 leading) with the highlighter on "research desk", the
  supporting line (sans 20px, muted, 34rem), **Install ZotLit** and **Start
  the tutorial**, and the requirements line in muted 14px. From 1280px the
  hero is at least as tall as the viewport below the nav and the banner
  (`--fd-banner-height`), held between 720px
  and the desk's scaled height, and grows with its text when a larger font
  needs the room; the text sits a little above centre.
- **The desk (from 1280px).** Six objects lie around the headline on a
  1440 × 832 stage, built in HTML on the docs Fixture's data, each named by
  a strip of washi tape (mono uppercase 10.5px on `--desk-tape`, rotated
  2.5°): the Library View sheet ("Browse your library") and the
  Reproducibility.zotquery table ("Compare your papers") lead at the
  top; the PDF page with the reader's marks ("Read and highlight"), the
  literature-note index card ("Take literature notes"), the draft with its
  citation picker ("Cite as you write") and the Word reference page
  ("Export and submit") lie below. Two blank sheets under the leads give
  depth. Each group (left, right, below) is drawn at 0.84 towards its own
  outer edge, so every object keeps at least 72px clear of the text at every
  width while the text keeps its size; a soft clearing of the ground colour
  sits behind the headline. The
  stage scales in steps with the window — 0.88 from 1280px, 0.94 from
  1360px, 1 from 1440px, 1.08 from 1800px — and the text zooms with it.
  Each object casts `--desk-shadow`. The desk is `aria-hidden`: the
  headline and the sections below carry its meaning.
- **Below 1280px.** The text, then the library sheet, the table and the PDF
  in a short fanned stack (460px wide at most).
- **Hero motion, once.** The objects drop onto the desk in order (library,
  table, PDF, note card, draft, references; 100–1100 ms delays): a 38px
  fall with a 5° turn and a 7% shrink over 780 ms. Then the ratings fill in,
  the table's cell focus lands, the citation picker opens, the draft's caret
  blinks three times and the highlighter sweeps across "research desk" (at
  2.3 s). From 1280px the
  objects drift with a fine pointer, each by its depth, up to 8px. All of it
  is CSS under `motion-safe:`, except the drift, which writes `translate` on
  each object in one animation frame. The prerendered page and reduced
  motion show the final state.
- **Workflow: "From Zotero to finished chapter."** On the surface at 40%.
  A centred H2. Then five steps — Find a paper, Read and highlight, Write the
  literature note, Cite as you draft, Export your chapter to Word — in a zig-zag from
  1024px around a vertical hairline, each numbered on the line by a 36px
  circle (mono, accent text tone); below 1024px the list order carries the
  sequence. Each step: the step title (display, 2.25rem from 640px), one
  outcome line (sans 18px, muted), an optional note on the quiet fill (the
  Better BibTeX requirement), and a link to the step's lesson that names it
  ("Open the citation lesson →"); no two lesson links on the page share text.
  Beside it, the step's recording (see Recordings).
- **Compare your papers.** The H2
  "Compare your papers side by side.", one line and "Open the literature
  table lesson →" to `/learn/literature-review-table-from-zotero`. Then the
  demo, a figure: an Obsidian window (11px radius, `--desk-window-shadow`)
  enacts the collection becoming a table. In the Library View the reader
  saves the Reproducibility collection as a query file
  (Thesis/Reproducibility.zotquery); it opens as a table whose column
  tracks are all reserved from the first frame, so the columns — Literature
  note, Year, Publication, Creators — fill in place left to right; the rows
  sort by year; and the rating column from the literature notes is typed
  in for the two papers that have a note, while the two without one read
  "No note" and offer Create. Phones keep Title, Year and rating. Under
  the window, a five-beat caption trail (Pick a collection, Save as a
  table, Choose columns, Sort by year, Add your rating): a hairline per beat
  that fills with the accent over the beat, a mono "01" in the accent text
  tone and the beat in serif italic; on phones, the current beat alone
  ("02 / 05"). The figure's caption, for screen readers, says what the
  table ends up showing. Then three points on hairlines: "What Zotero
  knows.", "What you decided.", "What you have not read yet.".
- **The demo's timing.** One cycle runs 19.8 s and fades out over its last
  650 ms. The page prerenders the finished frame, which reduced motion
  keeps. With motion on, the demo waits at the collection while it is off
  screen, plays while at least half of it is on screen, and starts again
  from the collection once it has left. A pause button sits at the end of
  the caption trail; pausing rests the demo on its finished frame, and play
  starts it again from the collection. Rows and cells move by FLIP
  (transform and opacity); the tree collapses by width.
- **Trust row.** Three serif statements (20px) on the ground under the
  section's hairline, in three columns from 640px: "Private, on your
  computer.", "Free and open source.", "Works with Zotero 9 and 10.".
- **Closing call.** A band on the quiet fill: the H2 "Start your next
  chapter with ZotLit." and the two actions, centred. The requirements line
  appears once on the page, under the hero's actions.
- **Labels.** The layout explains; a label or description appears only where
  position and grouping cannot say it.
- **Recordings.** Each workflow step shows a recording of the real app at
  `public/img/landing/<case>` — `find`, `read`, `note`, `cite`, `word` — a
  1600 × 1000 WebP still and, where the case has one, an MP4 and a WebM
  clip; `CLIPS` in `workflow.tsx` names the cases with a clip. The frame is
  16:10 (`object-fit: cover`), 12px radius, on the surface with the shadow
  ring. The page prerenders the still. After mount, the recording player
  (see Illustration) mounts once its frame comes within 300px of the
  viewport (`preload="metadata"`, the still as its poster) and plays while
  it crosses the middle band. The alt text says what the recording shows.
- **Pause buttons.** The table demo's pause button: 36px round on the
  surface with the shadow ring, a Lucide Pause or Play icon and a label
  that names the loop ("Pause the demo"); hidden under reduced motion.
- **Inside the app windows.** The desk's sheets and the demo's window use
  ZotLit's own labels (the plugin's `m.*` messages) and Lucide icons on the
  site tokens; the Zotero annotation colours and Obsidian's purple
  (`--desk-purple`, with `--desk-selected` and `--desk-own` for the
  selected row and the note-property column) appear only there. Sample
  research data — titles, authors, citation keys, the chapter text, the
  references — stays as data in `papers.ts` and the components, not as
  messages.
- **Actions.** **Install ZotLit** (to the install page) fills with the
  accent text tone and carries the text-on-accent tone; **Start the
  tutorial** (to `/learn`) is the surface with the shadow ring. Both are
  44px tall, 10px radius, sans semibold 15px; side by side from 640px,
  stacked full-width below. Keyboard focus on the landing's actions, links
  and pause buttons draws a 2px outline in the accent text tone at 2px
  offset, which keeps 4.5:1 on the quiet fill of the closing band where the
  brighter ring falls below 3:1.
- **Type.** Display headings take the serif at weight 500 (the type
  system), not the prototype's semibold; section labels are mono uppercase
  at 13px, muted, 0.12em tracking.
- **Copy.** Sentence case, short sentences, active voice, research outcomes
  over mechanisms. Every string is a `docs_home_*` message. Highlights are
  never said to save or write back to Zotero.

### Learn (`/learn`)

Target. Prototype: round 1 of `prototypes/learn-prototype/prototype-learn.html`
on `prototype/learn-tutorial`: variant D's course page and checklist.

The course page lets a non-technical researcher pick the chore they want
gone; a lesson is a checklist they follow in the real app. The reader keeps
Obsidian open on the other half of the screen, so every layout is drawn
first for a 700px window, then checked at 390px and 1440px. A lesson page
holds what the reader needs to do the steps and little else: the layout
explains, and each fact appears once (see The label voice).

- **Type.** One scale in rem for every `/learn` page, each size with its
  unitless line-height, from the role classes in
  `src/components/learn/lesson-mdx.tsx`:

  | Role | Size | Line-height | Carries |
  | --- | --- | --- | --- |
  | Label | 11px (0.6875rem), mono uppercase | 1.25 | "You end with", the shell's "Learn", the player's time |
  | Meta | 15px (0.9375rem) | 1.45 | the minutes, the needs and note, the progress count, buttons, card meta |
  | Body | 17px (1.0625rem) | 1.55 | the lede and every step text: action, check line, fix, figure table |
  | Title | 20px (1.25rem) | 1.25 | step titles, the panel title, the outcome, card titles, the wordmark |
  | Section | 28px (1.75rem) | 1.2 | the course page's section heading only |
  | Display | 38px (2.375rem), 34px below 561px | 1.12 | the H1 |

  A lesson page sets five sizes (label, meta, body, title, display) and the
  course page six. Inline code in step text is mono 15px; a UI label is
  semibold at the text's own size. In a step, an `ActionLink`
  takes the meta size, an inline `Command` the text's size, and a block
  `Command` its name at the title size. Step titles carry the lesson's only H2 style.
- **Shell.** The course sits outside the docs layout: a top bar (the
  wordmark, a mono "Learn" label, then "All lessons" and "Docs" as muted
  links, over a hairline) and one centred column, 720px at most, with 20px
  side padding. From 1280px (`xl`) the course page widens to 1180px and a
  running lesson to 1400px with its media panel; below that, every page
  keeps the one column.
- **Course page.** The question as the H1 over a muted lede; a **Continue
  Lesson N** button (ink fill) once the reader has progress. Then lesson 1
  as a raised card with a 4px accent bar on its leading edge — the chore as
  a serif title, the minutes, the start button and the result picture
  beside it from 561px (above it below); its place and width say "start
  here". Once lesson 1 is done, the card becomes a strip on the check tint:
  a check disc, the chore and an **Open it again** link. Then the section
  heading "Then pick a chore" and one raised card per chore: the lesson's
  result picture, the chore in the reader's words as a quoted serif title
  that links the whole card, and one muted meta line with the minutes and
  the progress ("Done" with a check in the check green, `#2f7d4f`, 4.6:1 on ground, or "N of M done"
  in the accent text tone). From 1280px the header keeps 680px, and the
  chore cards sit in a six-column grid, three cards over two (spans 2, 2,
  2, 3, 3), each with its picture on top.
- **Result picture.** The lesson's last step: its poster
  (`step-<n>.poster.webp`, the clip's final frame framed on the result) or,
  until one exists, its screenshot. On a card it fills a window-shaped
  frame from the top.
- **Opener.** The minutes ("About 12 minutes", muted meta), the lesson
  title as the H1, the lesson's `instead` as one lede sentence, then one
  compact block in meta size: "You need" and the needs on one line (each
  need semibold, its detail muted in brackets) and the lesson's note as a
  muted second line.
- **Outcome.** Below 1280px, and on the prerendered page, the result shows
  once, directly above the checklist: the mono "You end with" label in the
  accent text tone and the outcome as a serif title beside the last step's
  recording from 561px (above it below). The recording rests on its poster
  with its play button and plays only when the reader plays it. While no
  row is open, the Start button sits under the title (see Start).
- **Start.** A new reader — no ticks, no `#n` in the address — finds every
  row closed and the outcome in view, with one leading action under it:
  **Start step 1** (ink fill, with an arrow). It names the step it opens,
  so the reader knows the recording beside it changes from the result to
  that step. Pressing it does what selecting step 1's title does: row 1
  opens, the panel (from 1280px) turns to step 1, focus moves to row 1's
  title, the row scrolls into view when it is out of sight, and the polite
  live region says that step 1 is open, with its title. Being a press, it also plays
  the step's recording at once (still under reduced motion). Whenever no
  row is open later — the reader closed the open one — the outcome returns
  with **Continue with step N** for the first step not ticked; once every
  step is ticked, the outcome stands without it. The panel turns only on an
  act of the reader: Start, a row's title, a tick, or **Go to step N**.
- **Progress bar.** Sticky under the banner as the checklist scrolls: one
  segment per step across the column — check green when ticked, ink for
  the open row, the line colour otherwise — and the count as "3/7" in meta
  size, tabular, muted (check green when all are done). A screen reader
  reads "3 of 7 done".
- **Row.** Each step is a row: a 28px checkbox (a 1.5px muted ring, filled
  check green with a ground-coloured check when ticked; named "Step 2 of 6:
  title"), then a disclosure button holding the step number (regular,
  tabular, muted; the accent text tone on the open row) and the step title
  (sans semibold at the title size; muted and regular once ticked) with a
  chevron. Closed rows sit on hairlines. The open row is a raised card
  (14px radius) and, below the title, shows the action, the picture, the
  check line, any figure, then **Tick step N** (the ink-filled leading
  action, with a check) beside **Not what you see?**. Ticking a row, by its
  checkbox or by Tick step N, closes it and opens the next row not ticked;
  any row reopens from its title. A ticked row opened again shows a check
  with "Ticked" in check green and **Go to step N** (**See the end** once
  every step is ticked) on the surface with the shadow ring. After either
  button, focus moves to the title of the row that opens, or to the end.
  The body fades and rises 6px over 220 ms when it opens (none under
  reduced motion).
- **Media panel.** From 1280px, on a running page, the lesson is a 580px
  checklist column and, 48px beside it, a sticky panel. While no row is
  open it shows the outcome: "You end with", the outcome as a serif title,
  the last step's recording at rest on its poster, and the Start button
  under it. With a row open it shows that row: the step number (a check in
  check green once ticked) and title in serif at the title size, then its
  recording, which plays at once after Start and otherwise while it
  crosses the middle of the window. A reader with ticks saved starts on the
  first step not ticked, and one who follows a link to a step starts
  there. The rows then show no picture of their own, so one player
  mounts per step. The prerendered page and a reader without JavaScript
  keep the one column, with every picture in its row.
- **Picture.** One recording of the step in the real app, in the recording
  player (see Illustration), 10px radius, with the shadow ring, at most
  560px or 70% of the window tall. Only the open row's clip and the
  outcome load. The open row's clip plays at once after Start, and
  otherwise while it crosses the middle of the window; the outcome waits
  for the reader's play; one plays at a time. There is no zoom control: the recordings frame the action
  themselves.
- **Action.** Body size, each control named in semibold at the text's size;
  a link, such as the `obsidian://` shortcut in lesson 1, is underlined in
  the accent text tone.
- **Check line.** What the reader should now see, in a 10px-radius band:
  dark green `#1f5c39` text on `#e9f3ec` (7.0:1) in light; `#7cc79a` on
  `#17261d` (7.9:1) in dark². The band names itself; a screen reader hears
  "You should see" first.
- **Fix panel.** **Not what you see?** — a muted underlined link-style
  button with a chevron — toggles (`aria-expanded`) a panel on the warm
  tint, 10px radius, 14px padding: each likely failure as a semibold
  heading at body size and the fix in one or two sentences; it closes on
  "None of these. Ask in the community →" in the accent text tone.
- **End.** Once every step is ticked, a raised card: a check disc beside
  "Lesson 1 complete" (the row title style), one line on what ZotLit now
  does, "Two more chores" in muted semibold meta — small cards with the
  result picture, the quoted chore and the minutes, lesson 1 first while it
  is not done — and **See all chores** in the accent text tone. Until then
  the checklist ends on its last row.
- **Focus and state.** Every control is a button, link or checkbox with a
  2px accent outline at 2px offset on keyboard focus. Ticked state shows as
  a check and as the count text, never by colour alone.

² The dark check-line pair is derived for this spec; the prototype draws the
light scheme only.

### Changelog (`/changelog`)

List/detail pages in the `_home` route group styled with Tailwind over fd
tokens. Each release: right-aligned gutter (mono-uppercase date, mono version
badge; latest badge orange-bordered), a serif release title, an optional
companion note (`src/components/companion-note.tsx`) — a leading accent `Puzzle`
mark on a muted italic line — then the release notes at digest density.

Both views render the release notes with a **sans body**. The `##` category
dividers (Breaking Changes / What's New / Bug Fixes) speak the **mono-uppercase
label voice** rather than display headings — set in ink with an accent left-bar
(the repo-datum motif) so each reads as a deliberate section rule, larger on the
detail page (`text-sm`) than in the compressed list digest (`text-xs`). `###`
feature names carry the serif display weight; the release title (`v{version}` /
the serif standfirst) stays the dominant element. The list runs as a tighter
digest, but the type roles hold across both. The detail head
leads with a mono-uppercase `← Changelog` crumb (the blog's `← Blog` register).
Changelog is not indexed in search.

### Blog (`/blog`)

The changelog's sibling in the `_home` route group:

- **Index**: two-column annals grammar — gutter with date/byline; body with
  serif title, italic deck, "Read the post →" link in the accent text tone.
  Closes on the shared `SiteFooter`.
- **Post head**: "← Blog" caps crumb, serif title, italic standfirst,
  mono-uppercase meta line, hairline, then `ztProse` body.
- **Post tail**: `FooterCards` prev/next, then comments (Giscus).

### Docs content column

- Title: serif, medium weight, balanced.
- Description: serif italic.
- Prose body: sans, serif h1–h3 at weight 500 with balance and the compensated
  scale, h4 as a mono-uppercase label, inline code square-cornered, `kbd` mono.
- Blockquotes and figcaptions carry the serif-italic editorial register.
- Lists run tighter than paragraphs (0.75em block margins, 0.25em item gaps).
- **Command references** (`src/components/command.tsx`): leading Lucide `Terminal`
  glyph (accent) + command name in serif display voice + a mono-uppercase
  `Copy →` link.
  Block form rules a hairline; inline form is glyph + underlined name only.

### Docs chrome (sidebar)

Sans page links, mono-uppercase rubric labels. The sidebar keeps Fumadocs' stock
shapes (rounded rows, tinted active pill, indent guides) via the owned slot; the
type carries:

- **Folder rows speak orange mono uppercase** (0.72rem, weight 600, 0.1em
  tracking) in the accent text tone.
- **`links`-prop entries** sit in muted mono uppercase (0.72rem, weight 500,
  0.08em tracking) — set apart from folders by color and from page links by
  case. The home nav shares this mono-uppercase voice at 0.8125rem.
- **Page links** lead in near-ink (0.84rem, foreground mixed 82% toward muted).
- Active states keep the stock shapes: a pill on the warm tint
  (`fd-accent`) with `fd-primary` text (4.8:1 light, 5.6:1 dark), and the
  guide-line bar on nested items.

The mobile header carries the same double-hairline signature as the home nav.

### Comments

Mounted via the docs page footer slot after prev/next cards.
`src/components/comments.tsx` renders a lazy Giscus mount with no heading of
its own — Giscus's live comment-count header is sufficient. Its theme follows
the colour scheme through `public/giscus/light.css` and `dark.css`, which
restate the Journal tokens over Giscus' Primer variables; change them with
`src/styles.css`.

### Social cards (OG)

`src/lib/og-card.tsx` draws every card on the light Journal ground: a mono
label in the accent text tone over an accent rule, the serif title, sans
description and mono meta line in ink, and an ink-ruled footer with the
brand mark and the wordmark in its brand inks.

## CSS architecture

Structural chrome overrides live in the owned layout slots. CSS in
`src/styles.css` is reduced to what CSS alone must do:

- **Tokens** — the `--color-fd-*` palette, the brand inks, the shadow ring,
  and the `@theme inline` font wiring.
- **`#toc-title`** — the one accepted Fumadocs-shipped anchor (ships with this
  exact id, no className hook). Re-check on bumps.

Surface component styles (the landing's desk and table demo, the lesson
checklist) live with their components as Tailwind utilities and arbitrary
variants; `src/styles.css` holds only their tokens and their `@theme`
animations (`animate-desk-*`, `animate-demo-*`).

The docs/blog prose restyle is **not** here. Customize Fumadocs prose through
its **typography element modifiers** (`prose-h2:…`, `prose-blockquote:…`) — the
plugin's own customization surface — never hand-written `.prose`-descendant CSS
in `src/styles.css`. Modifiers carry the `not-prose` escape hatch and win over base
`prose` by layer order, so no unlayered override is needed. The shared set lives
in `src/lib/prose.ts` (`ztProse`), applied on `<DocsBody>` and the blog post. The
fork's modifiers are single-element only; a descendant compound with no modifier
(`li p`, nested lists) uses a Tailwind arbitrary variant (`[&_li_p]:…`) — still
inline, still not `src/styles.css`.
