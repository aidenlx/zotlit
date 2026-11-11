# ZotLit docs site — design spec

Theme: **"Journal"** — warm paper ground, near-black ink, deep-orange accent.
One token system (`--color-fd-*` overrides in `src/styles.css`) drives all
surfaces: landing, changelog, blog, docs, `/learn`, and the Template Workbench.

Compose each surface around the reader's task. Editorial pages lead with
content; the Workbench gives space to editing and inspecting the result;
a lesson gives space to the one step the reader is doing.
Apply the shared brand rules together with the relevant per-surface section.
Use [the brand specification](../../docs/brand.md) for logo and wordmark assets.

Visual references, each on its own branch: the landing at
`apps/docs/landing-prototype/landing-prototype.html` on
`prototype/landing-research-desk`, and the lesson step at
`apps/docs/lesson-prototype/learn-lesson.html` on `prototype/lesson-shell`.
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
| Citation blue | `#2756b0` | `#8aaaf0` | rendered citations inside demos and replicas |
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
they mean Zotero highlights: in recordings, replicas and the desk's open paper.

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
- Landing section labels ("Contents", "In this job", "What you need") and the
  `/learn` lesson labels ("Lesson 1 of 6", "Step 2 of 6")
- Changelog/blog dates and meta lines; version-ledger row labels
- Docs sidebar folder + `links`-prop rows, the TOC "On this page" title, docs
  prose h4, and the command `Copy →` affordance

Numerals that count or order — "03 / 08", "Step 1", "01" in a contents list
— take the mono face in normal case, with the current or leading number in the
accent text tone.

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

- **Shadow ring.** A raised surface (card, replica window, secondary button,
  current contents row, numbered marker) takes `border: 1px solid transparent`
  under the layered ring, so forced-colors mode still draws an edge. The ring
  is a token pair in `src/styles.css`, reached as the `shadow-ring` and
  `shadow-ring-hover` utilities:
  - light: `0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06), 0 2px 4px 0 oklch(0 0 0 / 0.04)`;
    hover: the same layers at 0.08 / 0.08 / 0.06;
  - dark: `0 0 0 1px oklch(1 0 0 / 0.08)`; hover at 0.13.
- **Hairlines for structure.** Section rules, list dividers, table rows and
  card dividers use `border-fd-border`. A list head sits on a 1px ink rule.
- **Radii.** Buttons 10px; list rows and small controls 8px; cards, replica
  windows and lesson pictures 10–14px. Where surfaces nest with an even
  inset, the outer radius is the inner radius plus the padding.
- **Buttons.** The kit's primary button (`src/components/ui/button.tsx`) fills
  with the accent text tone and carries the text-on-accent tone. On the
  landing and `/learn`, the leading action is 44px tall, sans semibold, ink
  fill with ground text; the secondary action is the surface with the shadow
  ring (Target).
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
- **Loops.** At most one loop plays in view at a time — a lesson recording or
  a landing demo: it runs while it crosses the middle band of the viewport and
  rests elsewhere. With reduced motion, each shows its finished frame.
- **Scroll.** The page scrolls as a document. Scroll-linked movement belongs
  to the landing's desk alone (see Landing).

## Illustration

A view explains before a paragraph does. Prefer a recording, a replica, a
map, a before/after pair or a small table over prose; keep the words to a
heading, one caption and one check line.

- **Lessons show recordings.** Each `/learn` step shows a short recording of
  the real app doing that step: about 3–8 seconds, looping, resting on the
  result. Reduced motion shows the last frame. A static screenshot of the
  result is the poster and the fallback. The reader then does the step once,
  in their own Obsidian, so a lesson ends with a working setup on their own
  library.
- **The landing shows replicas.** Features appear in small app windows built
  from the real app's own assets: ZotLit's components, styles, labels and the
  open Lucide icons, on real-looking research data, inside a plain window
  frame of our own. Obsidian's own stylesheet and window chrome stay out.
- **The landing lets a visitor try one moment** (Target). Inside a replica, a
  visitor tries a signature moment in about 20 seconds before any install,
  and the moment hands them to Install and Lesson 1. The first: type `[@` in
  a draft, pick a paper, and the formatted citation appears. Further
  candidates: drag a highlight into a draft so the quote arrives with its
  page; mark a paper "to-read" in the reading table.
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

Target. Prototype: `apps/docs/landing-prototype/landing-prototype.html` on
`prototype/landing-research-desk`.

The landing tells one story: **"An integrated research desk for Obsidian."**
Eight research jobs in the order a researcher meets them, each with its
replica and its complete feature list. Content width 1240px with 32px side
gutters (16px on phones).

- **Header.** The shared home nav (see Owned layout slots). The GitHub link
  carries the live star count (`<RepoDatum>`).
- **Hero.** Two columns from 1024px. Left: the H1 "An integrated research desk
  for Obsidian." (display, 4.4rem / 1.02; 3.6rem from 640px; 2.6rem on phones)
  with the highlighter on "research desk". Right, aligned to the H1's last
  line: the supporting line "Find, read, annotate, cite and export the papers
  in your Zotero library, right beside the notes you write." (sans 18px,
  muted, 46ch); **Install ZotLit** (primary) and **Read the docs**
  (secondary); the requirement line in muted 13.5px — Obsidian version ·
  Zotero version · desktop platforms. One column below 1024px.
- **Hero entrance, once.** Title, supporting line (+100 ms), actions and
  requirements (+200 ms), the figure (+300 ms): opacity, 4px blur and a 12px
  rise over 300 ms ease-out. Under reduced motion: opacity only.
- **Figure 1: the desk.** The desk (below) at the full content width, with its
  numbered markers. The figcaption reads "**Figure 1.** Your research desk,
  seen from above. Each object is one job in a research project. Select one to
  read about it." (sans 15px, muted, "Figure 1." in ink semibold), beside the
  **key**: eight rows of object icon, number and job name, in two columns from
  640px. Pointing at or focusing a key row rings its object on the desk;
  selecting it scrolls to the job and moves focus there. From 1024px the
  caption and key stay clear of the contents column's track
  (`max-width: calc(100% - 364px)`).
- **Contents column (from 1024px).** The job sections run in a
  `minmax(0, 1fr)` column beside a 300px column, 64px apart. The 300px column
  sticks 32px below the viewport top and holds the docked desk (no markers;
  the job in view ringed, the others faded), the "Contents" label, the eight
  jobs as rows (mono number + name; the current row raised on the surface with
  the shadow ring, its number in the accent text tone), and an "Install
  ZotLit →" link. The current job is the section that crosses 40% of the
  viewport height. Selecting a docked object or a contents row jumps to the
  job; smooth scrolling only when motion is on.
- **The desk shrinks into the column.** Scroll progress `p` runs from 0, when
  the hero desk's top reaches 72px from the viewport top, to 1, when the job
  column's top reaches the sticky line. Between the two, a fixed copy of the
  desk, anchored at its right edge, narrows from the hero width to the column
  width over the first 55% of `p` and moves to the column's top over all of
  `p` (smoothstep easing on both), so it never covers the text scrolling up
  beside it. The markers fade out over the first half; the focus ring and the
  fade on the other objects follow `p`; the contents list fades in with `p`.
  The scroll handler writes `p` and the phase (hero, moving, docked) on the
  page element in one animation frame, so the hand-off between the hero desk,
  the moving copy and the docked desk lands in the same frame and React stays
  idle while scrolling. With motion off or reduced motion there is no moving
  copy: the hero desk stays in place, and the docked desk and contents list
  cross-fade in over 150 ms at `p = 1`.
- **Below 1024px.** The hero desk and key, then the sections in one column,
  each heading led by its object icon. Once the figure has scrolled out, a top
  bar appears (ground at 90% with a backdrop blur and a hairline below): the
  eight object icons with their numbers, the current one on a raised tile, and
  the current job's name under the row. It enters with opacity and a 12px drop
  over 300 ms (opacity only under reduced motion) and is `inert` while hidden;
  sections carry a scroll margin that clears it.
- **Job sections.** A hairline rule, then "03 / 08" (mono 12px, the job number
  in the accent text tone), the job name as H2 (display, 2.6rem / 1.08), and
  one outcome line (sans 17.5px, muted, 52ch). Then each replica as a figure:
  the working window, a caption "Shown: *feature*" with its badges, and an
  optional one-line hint. Then **"In this job"**: every feature of the job,
  name linked to its docs page, badges (New in 2.2, Since 2.1, For power
  users, Experimental, Needs ZotLit Companion), and the one-line description;
  a filled accent dot marks the features the replica shows working. Two
  columns from 1280px.
- **Replicas.** Small app windows that show one feature working (see
  Illustration). Each window carries only the chrome the feature needs: a
  title bar and the pane that matters. The loop rule in Motion applies.
- **Setup: "Set up your desk".** Left: the H2, "Three steps, all inside
  Obsidian.", **Install ZotLit** and **Start the tutorial**. Right: the three
  install steps in one raised card (14px radius; three columns divided by
  hairlines from 768px), each with "Step N", its name, one line and a link;
  then "What you need" and "Optional add-ons for Zotero" as label-headed
  lists; then the privacy and licence lines with Lucide icons, under a
  hairline.
- **Footer.** The shared copyright footer (`src/components/site-footer.tsx`):
  hairline-topped "© year AidenLx · AGPL-3.0 Licensed" line, shared across all
  `_home` index surfaces (landing, blog index, changelog index).
- **Copy.** Sentence case, short sentences, active voice, research outcomes
  over mechanisms. Feature names exactly as the docs name them. Numbering only
  for the eight jobs and the install steps.

#### The research desk

One flat SVG drawing of an academic's desk seen from above (view box
1600 × 860). It is the hero figure, then the table of contents. Each object
stands for one research job:

| # | Job | Object | Replica(s) on the landing |
| --- | --- | --- | --- |
| 1 | Bring your library | File box labelled "My library" | Reads Zotero directly (with Group libraries) |
| 2 | Find a paper | Books and a magnifier | Library View (with Reading Card) |
| 3 | Read and annotate | Open paper with highlighter | PDF reader (with Annotation view) |
| 4 | Take literature notes | Notebook | Literature notes |
| 5 | Cite while you write | Manuscript on a clipboard | Citations in Live Preview (with Citation Suggester, Any citation style); Citation Popover |
| 6 | See how your sources connect | Pinboard with string | Citations in the graph view; References Sidebar |
| 7 | Export and submit | Printer, a page with a reference list coming out | Export with citations |
| 8 | Make it yours | Laptop and toolbox | Template Workbench |

- **Drawing language.** Flat fills from the desk palette; 1px hairline edges
  (non-scaling strokes) in the desk edge colour; small rounded corners. Each
  object casts a soft shadow: its shadow shapes offset by (3, 12) and blurred
  (Gaussian, σ 9). The blotter is deep slate (`#2d3746` light, `#283241`
  dark) with darker corner pockets and a dashed stitch 16 units inside its
  edge. A coffee cup is the one object without a job. The desk has no idle
  loop.
- **Palette.** Warm and desaturated:

  | | Light | Dark |
  | --- | --- | --- |
  | Desk surface | `#ebe7de` | `#1b1e23` |
  | Paper | `#ffffff` | `#c9c5bd` |
  | Edge | `#a7a297` | `#3a3e46` |
  | Shadow | `rgb(60 45 20 / 0.16)` | `rgb(0 0 0 / 0.40)` |
  | Steel (file box) | `#dcd7cd` | `#4a4f58` |
  | Device (laptop, printer) | `#d9dbdf` | `#5a5e66` |
  | Screen / printer slot | `#222a36` / `#2e3744` | `#10151d` / `#222935` |
  | Notebook | `#56685b` | `#3d4c42` |
  | Books | `#44587a`, `#8a7660`, `#8e3f35` | `#34445e`, `#6b5c4b`, `#6e342d` |
  | Cork | `#ece5d6` | `#8f887c` |

  The full set is the `[data-v="A"][data-kit]` block in the prototype's
  `R4_CSS`.
- **States.** The object in focus (pointed at, or the job in view) gets a 2px
  accent ring, a rounded rectangle 14 units outside it; the other objects fade
  to 35% opacity. In the hero, numbered markers sit at each object's corner:
  20px circles on phones, 28px from 640px up, mono numerals on the surface with
  the shadow ring; the active marker fills with the accent text tone. Pointing
  at an object shows its job name in an ink tag beside the marker.
- **Object icons.** Each object also renders alone as a pictogram (24–48px): in
  the figure key, the phone bar, and the phone section heads.
- **Accessibility.** The drawing is `aria-hidden`. The figure key and the
  contents list carry the names and the keyboard path; the object hit areas
  respond to the pointer only.

### Learn (`/learn`)

Target. Prototype: `apps/docs/lesson-prototype/learn-lesson.html` on
`prototype/lesson-shell`.

A lesson walks a non-technical researcher through one job in the real app,
one step per screen. The reader keeps Obsidian open on the other half of the
screen and does each step there.

- **Shell.** The lesson sits outside the docs layout: a top bar (the
  wordmark, a mono "Learn" label, then "All lessons" and "Docs" as muted
  links, over a hairline) and one centred column, 720px at most, with 20px
  side padding and 18px between blocks. The column stays narrow so the page
  reads at half a screen.
- **Strip.** The lesson's steps as a row of equal segments at the column top,
  a `nav` labelled "Steps of this lesson": each a 4px bar over its one-word
  name (sans 12px, muted). Done steps fill with the accent, the current step
  with ink and its name in ink semibold (`aria-current="step"`), later steps
  with the line colour. Each segment is a 44px-tall button that jumps to its
  step. Below 560px the names drop and the bars stay.
- **Step.** In order: a mono label "Step 2 of 6"; the step title (serif 500,
  30px / 1.15); the picture; the caption; the check line; the two buttons.
  The step body fades and rises 6px over 220 ms when it changes (none under
  reduced motion).
- **Picture.** One recording of the step in the real app (see Illustration),
  10px radius, with the shadow ring. Numbered marks sit on the controls the
  caption names: 26px circles in the accent text tone with numerals in the
  text-on-accent tone (sans 600) and a 3px surface-coloured halo. Where a step changes one screen into
  another, a before/after pair with a muted arrow between (stacked below
  560px).
- **Caption.** The action, sans 19px / 1.5, naming each control as a UI chip
  (sans semibold on the quiet fill, 5px radius) and referring to the marks by
  the same numerals inline (22px circles).
- **Check line.** "✓" and what the reader should now see, in a 10px-radius
  band: dark green `#1f5c39` text on `#e9f3ec` (7.0:1) in light; `#7cc79a`
  on `#17261d` (7.9:1) in dark².
- **Buttons.** **I see it. Next** (**I see it. Finish** on the last step)
  as the leading action — ink fill, ground text, 46px tall, 10px radius,
  semibold — and **I see something else** as a quiet button: transparent with
  a 1px line ring, muted text, ink on hover. A 2px accent outline at 2px
  offset marks keyboard focus.
- **Fix panel.** **I see something else** toggles (`aria-expanded`) a panel
  below the buttons on the warm tint, 10px radius, 14px padding: each likely
  failure as a sans-semibold 17px heading, an optional picture, and the fix
  in one or two sentences; it closes on "None of these. Ask in the community
  →" in the accent text tone.
- **Cover.** The lesson label ("Lesson 1 of 6 · about 10 minutes · 6 steps"),
  the lesson title (serif, 36px), a map of where things live (two raised
  boxes, Zotero and Obsidian, joined by an arrow labelled with what ZotLit
  does), a "You need" table on hairline rows, the **Start** button filled
  with the accent text tone, and the mono reminder "Keep Obsidian open beside
  this page."
- **End.** A "Lesson 1 complete" label in the check green (`#2f7d4f`, 4.6:1
  on ground), the outcome as the title, the finished result as the picture,
  one caption, a raised link card to the next lesson (title semibold, one
  muted line), and **Start again** as a quiet button.

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

Surface component styles (the desk's states, the hero entrance, the lesson
strip) live with their components as Tailwind utilities and arbitrary
variants; `src/styles.css` holds only their tokens.

The docs/blog prose restyle is **not** here. Customize Fumadocs prose through
its **typography element modifiers** (`prose-h2:…`, `prose-blockquote:…`) — the
plugin's own customization surface — never hand-written `.prose`-descendant CSS
in `src/styles.css`. Modifiers carry the `not-prose` escape hatch and win over base
`prose` by layer order, so no unlayered override is needed. The shared set lives
in `src/lib/prose.ts` (`ztProse`), applied on `<DocsBody>` and the blog post. The
fork's modifiers are single-element only; a descendant compound with no modifier
(`li p`, nested lists) uses a Tailwind arbitrary variant (`[&_li_p]:…`) — still
inline, still not `src/styles.css`.
