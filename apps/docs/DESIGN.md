# ZotLit docs site — design spec

Theme: **"Journal"** — warm paper ground, near-black ink, deep-orange accent,
and one illustration: a research desk seen from above. One token system
(`--color-fd-*` overrides in `src/styles.css`) drives all surfaces: landing,
changelog, blog, docs, and the Template Workbench.

Compose each surface around the reader's task. Editorial pages lead with
content; the Workbench gives space to editing and inspecting the result.
Apply the shared brand rules together with the relevant per-surface section.
Use [the brand specification](../../docs/brand.md) for logo and wordmark assets.

Visual reference: [`landing-prototype/landing-prototype.html`](landing-prototype/landing-prototype.html)
(open it in a browser; screenshots beside it). Where this spec and the
prototype differ, this spec wins.

## Key points

1. **An academic page, printed-journal calm.** Serif display, sans text, mono
   apparatus labels; figure-and-caption conventions ("Figure 1."); generous
   space; one focal point per screen.
2. **Show the work.** Every feature appears working in a small mock of the app,
   on real-looking research data. Prose stays to a heading, one outcome line
   and a caption.
3. **One story.** ZotLit is "An integrated research desk for Obsidian": eight
   research jobs in the order a researcher meets them, each with its demo and
   its complete feature list.
4. **One illustration.** The research desk: eight objects, one per job. It is
   the hero figure, then the table of contents.
5. **Shadows for elevation, hairlines for structure.** Raised surfaces take a
   1px shadow ring; section rules and dividers take `border-line`.
6. **Quiet motion.** One staged hero entrance, 150 ms state changes, one
   looping demo at a time, scroll-linked movement only for the desk. Reduced
   motion gets opacity fades.
7. **Readable colour.** Ink and muted text pass 4.5:1 on every surface; small
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
| Surface (cards, windows) | `#ffffff` | `#1b1e24` | `--color-fd-card`, `--color-fd-popover` |
| Ink (text) | `#1b2029` | `#e9e6df` | `--color-fd-foreground`, every `*-foreground` |
| Muted (secondary text) | `#5f6672` | `#9b978f` | `--color-fd-muted-foreground` |
| Line (hairlines) | `#e3dfd6` | `#2d3037` | `--color-fd-border` |
| Accent (rings, dots, fills) | `#e8622c` | `#f0793f` | `--color-fd-primary`, `--color-fd-ring` |
| Accent text tone | `#b9461a` | `#f0793f` | small accent text; accent fills that carry text |
| Deep slate | `#2d3746` | `#283241` | the desk blotter |
| Citation blue | `#2756b0` | `#8aaaf0` | rendered citations inside demos |
| Highlighter | Zotero yellow `#ffd400` at 48% | at 30% | the hero mark |

Measured contrast: ink on ground 15:1; muted on ground 5.3:1 (light) and
6.3:1 (dark); the accent text tone on ground 4.9:1; white on the accent text
tone 5.3:1; the dark accent on the dark ground 6.6:1. The light accent
`#e8622c` reaches 3.1:1 on the ground, so it marks rather than speaks: rings,
dots, rules and large numerals.

The Zotero annotation colours (`--z-yellow`, `--z-red`, …) appear only where
they mean Zotero highlights: in demos and on the desk's open paper.

## Type system

Four faces, four roles:

| Face | Role |
| --- | --- |
| **Newsreader** (serif, variable: optical size, weight, italic) | Content & display: headings, titles, the docs description and blog standfirst (italic), editorial annotations |
| **Source Sans 3** (sans, variable, upright and italic) | Prose body & chrome: running text, landing ledes and outcome lines, captions, buttons, sidebar, TOC, search |
| **IBM Plex Mono** (weights 400/500/600) | The **"Machine" voice**: code, numerals (job and step numbers, counts), meta lines, and every UPPERCASE apparatus label. Drives `--font-mono`. |
| **Archivo** (subset woff2) | Wordmark only — subset to exactly the "ZotLit" glyphs |

Display headings at landing sizes (2rem and up) set Newsreader at **weight
400** with **-0.012em** tracking and `text-wrap: balance`; the optical-size
axis draws the display cut at these sizes. Prose headings h1–h3, which run
smaller, set it at **weight 500**. Landing ledes and job outcome lines stay in
the sans body face, muted, at 17.5–18px with relaxed leading; docs
descriptions and blog standfirsts keep the serif italic. Numerals in tables,
counters and job numbers use `tabular-nums`.

Serif is **opt-in**, not blanket-inherited: the app-wide default is sans, and
each editorial surface opts its display type into serif. Shared `_home` chrome
— nav, banner, search — stays sans/mono. A sans prose body inside a serif
surface stays sans; only its display headings take the serif.

The `ztProse` heading scale (`src/lib/prose.ts`) is tuned to the display
face's x-height against the sans body; re-tune it against Newsreader when the
faces change, and keep blockquotes at optical parity with the body.

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
- Landing section labels: "Contents", "In this job", "What you need",
  "Optional add-ons for Zotero", the feature count
- Changelog/blog dates and meta lines; version-ledger row labels
- Docs sidebar folder + `links`-prop rows, the TOC "On this page" title, docs
  prose h4, and the command `Copy →` affordance

Numerals that count or order — "03 / 08", "Step 1", "01" in the contents list
— take the mono face in normal case, with the current or leading number in the
accent text tone.

Docs-chrome labels ride the same voice at a smaller size (~0.72rem) and quieter
weight — micro-apparatus inside the sans body rather than marketing display, but
the same mono-uppercase register.

**Running prose stays in normal case**, even in chrome: full sentences read as
text, not labels — so the v2 banner notice, tooltips, figure captions and any
sentence-shaped copy keep their upright case and sans body voice. The Archivo
wordmark likewise stays outside label treatment.

The [Template Workbench](WORKBENCH-DESIGN.md) uses Inter sentence case
for its utility chrome, including labels and pane headings.

## Surfaces and elevation

- **Shadow ring.** A raised surface (card, demo window, secondary button,
  current contents row, numbered marker) takes `border: 1px solid transparent`
  under a layered ring, so forced-colors mode still draws an edge:
  - light: `0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06), 0 2px 4px 0 oklch(0 0 0 / 0.04)`;
    hover: the same layers at 0.08 / 0.08 / 0.06;
  - dark: `0 0 0 1px oklch(1 0 0 / 0.08)`; hover at 0.13.
- **Hairlines for structure.** Section rules between jobs, list dividers, the
  parts list rows and the setup card's dividers use `border-line`. The parts
  list head ("In this job") sits on a 1px ink rule.
- **Radii.** Buttons 10px; list rows and small controls 8px; cards and demo
  windows 12–14px; the desk surface 24px in its own drawing units. Where
  surfaces nest with an even inset, the outer radius is the inner radius plus
  the padding.
- **Buttons.** 44px tall, sans semibold 15px. Primary: ink fill, ground text,
  a trailing Lucide `ArrowRight` (16px), 2px less padding on the icon side.
  Secondary: surface with the shadow ring, hover raises the ring.
- **The highlighter.** One phrase per page carries it — "research desk" in
  the hero: a 0.28em band of the highlighter colour at 88% of the line box,
  drawn as a background image so it wraps with the text.

## Motion

Values follow the `better-ui` skill.

- **Hero entrance, once.** Title, supporting line (+100 ms), actions and
  requirements (+200 ms), the figure (+300 ms): opacity, 4px blur and a 12px
  rise over 300 ms ease-out. Under reduced motion: opacity only.
- **State changes.** 150 ms ease-out on the properties that change — opacity,
  color, background-color, box-shadow — named one by one.
- **Press.** Buttons scale to 0.96 over 150 ms ease-out, under
  `prefers-reduced-motion: no-preference`, and stay still when disabled.
- **Hover.** Hover styling applies on hover-capable pointers only (Tailwind 4's
  `hover:` does this).
- **Colour-scheme switch.** Transitions are suspended for the swap and
  restored on the next frame.
- **Loops.** At most one looping demo plays at a time: a demo runs while it
  crosses the middle band of the viewport and rests on its first frame
  elsewhere. With motion off, each demo shows its finished frame. The desk
  has no idle loop.
- **Scroll.** The page scrolls as a document. The desk's move into the contents
  column is the one scroll-linked effect, and it reverses when the reader
  scrolls back (see Landing).

## The research desk

One flat SVG drawing of an academic's desk seen from above (view box
1600 × 860). Each object stands for one research job:

| # | Job | Object | Demo(s) on the landing |
| --- | --- | --- | --- |
| 1 | Bring your library | File box labelled "My library" | Reads Zotero directly (with Group libraries) |
| 2 | Find a paper | Books and a magnifier | Library View (with Reading Card) |
| 3 | Read and annotate | Open paper with highlighter | PDF reader (with Annotation view) |
| 4 | Take literature notes | Notebook | Literature notes |
| 5 | Cite while you write | Manuscript on a clipboard | Citations in Live Preview (with Citation Suggester, Any citation style); Citation Popover |
| 6 | See how your sources connect | Pinboard with string | Citations in the graph view; References Sidebar |
| 7 | Export and submit | Out tray | Export with citations |
| 8 | Make it yours | Laptop and toolbox | Template Workbench |

- **Drawing language.** Flat fills from the desk palette; 1px hairline edges
  (non-scaling strokes) in the desk edge colour; small rounded corners. Each
  object casts a soft shadow: its shadow shapes offset by (3, 12) and blurred
  (Gaussian, σ 9). The blotter is deep slate with darker corner pockets and a
  dashed stitch 16 units inside its edge. A coffee cup is the one object
  without a job.
- **Palette.** Warm and desaturated:

  | | Light | Dark |
  | --- | --- | --- |
  | Desk surface | `#ebe7de` | `#1b1e23` |
  | Paper | `#ffffff` | `#c9c5bd` |
  | Edge | `#a7a297` | `#3a3e46` |
  | Shadow | `rgb(60 45 20 / 0.16)` | `rgb(0 0 0 / 0.40)` |
  | Steel (box, tray frame) | `#dcd7cd` | `#4a4f58` |
  | Tray / screen | `#3b4555` / `#222a36` | `#2b3442` / `#10151d` |
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

## Font loading

Fontsource serves all four faces from the package's own assets: the `@import`s
at the top of `src/styles.css` register them, and the `@theme inline` block in
the same file assigns the roles. Metric-adjusted local fallback faces in that
stylesheet keep every font swap shift-free; compute the overrides from each
face's own metrics.

Newsreader's upright and italic latin faces preload in `src/routes/__root.tsx`
because serif display paints on essentially every route. Source Sans 3 stays
unpreloaded because its adjusted fallback stabilizes the app-wide body and
chrome until the real face loads.

The mono fallback stands in for a fixed-pitch face, so it names monospace
locals instead of a proportional face — a proportional stand-in matches Plex
Mono across mixed-case prose and then runs ~38% wide on the short uppercase
apparatus labels, which is where the swap moves the layout. Those locals carry
no `size-adjust`: every monospace face shares Plex Mono's 0.6em advance, so the
overrides pin the vertical metrics alone.

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

The landing tells one story: **"An integrated research desk for Obsidian."**
Content width 1240px with 32px side gutters (16px on phones).

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
- **Figure 1: the desk.** The desk at the full content width, with its
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
  one outcome line (sans 17.5px, muted, 52ch). Then each demo as a figure: the
  working demo in a plain app-window frame, a caption "Shown: *feature*" with
  its badges, and an optional one-line hint. Then **"In this job"**: every
  feature of the job, name linked to its docs page, badges (New in 2.2, Since
  2.1, For power users, Experimental, Needs ZotLit Companion), and the
  one-line description; a filled accent dot marks the features the demo shows
  working. Two columns from 1280px.
- **Demos.** Small mock windows that show one feature working on real-looking
  research data (real papers, a thesis chapter, a reading group). Each window
  carries only the chrome the feature needs: a title bar and the pane that
  matters. The loop rule in Motion applies.
- **Setup: "Set up your desk".** Left: the H2, "Three steps, all inside
  Obsidian.", **Install ZotLit** and **Start the tutorial**. Right: the three
  install steps in one raised card (14px radius; three columns divided by
  hairlines from 768px), each with "Step N", its name, one line and a link;
  then "What you need" and "Optional add-ons for Zotero" as label-headed
  lists; then the privacy and licence lines with Lucide icons, under a
  hairline.
- **Footer.** The shared copyright footer (`src/components/site-footer.tsx`).
- **Copy.** Sentence case, short sentences, active voice, research outcomes
  over mechanisms. Feature names exactly as the docs name them. Numbering only
  for the eight jobs and the install steps.

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
  serif title, italic deck, orange "Read the post →" link. Closes on the
  shared `SiteFooter`.
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
- **Page links** lead in near-ink (0.84rem, foreground mixed 82% toward ink).
- Active states are stock (tinted pill with `fd-primary` text, guide-line bar
  on nested items).

The mobile header carries the same double-hairline signature as the home nav.

### Comments

Mounted via the docs page footer slot after prev/next cards.
`src/components/comments.tsx` renders a lazy Giscus mount (theme follows color
scheme) with no heading of its own — Giscus's live comment-count header is
sufficient.

## CSS architecture

Structural chrome overrides live in the owned layout slots. CSS in
`src/styles.css` is reduced to what CSS alone must do:

- **Tokens** — the `--color-fd-*` palette, the accent text tone, the shadow
  ring, the desk palette, and the `@theme inline` font wiring.
- **`#toc-title`** — the one accepted Fumadocs-shipped anchor (ships with this
  exact id, no className hook). Re-check on bumps.

The landing's component styles (the desk's states, the hero entrance, the
scroll-linked desk) live with the landing components as Tailwind utilities and
arbitrary variants; `src/styles.css` holds only their tokens.

The docs/blog prose restyle is **not** here. Customize Fumadocs prose through
its **typography element modifiers** (`prose-h2:…`, `prose-blockquote:…`) — the
plugin's own customization surface — never hand-written `.prose`-descendant CSS
in `src/styles.css`. Modifiers carry the `not-prose` escape hatch and win over base
`prose` by layer order, so no unlayered override is needed. The shared set lives
in `src/lib/prose.ts` (`ztProse`), applied on `<DocsBody>` and the blog post. The
fork's modifiers are single-element only; a descendant compound with no modifier
(`li p`, nested lists) uses a Tailwind arbitrary variant (`[&_li_p]:…`) — still
inline, still not `src/styles.css`.
