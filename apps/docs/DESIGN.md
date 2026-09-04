# ZotLit docs site — design spec

Theme: **"Manuscript & Machine"** — cream ground, navy ink, deep-orange accent.
One token system (`--color-fd-*` overrides in `src/styles.css`) drives all
surfaces: landing, changelog, blog, docs.

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

## Type system

Four faces, four roles:

| Face | Role |
| --- | --- |
| **Gelasio** (serif) | Content & display: headings, titles, descriptions/ledes/standfirsts, feature descriptions, editorial annotations |
| **Inter** (sans, unpreloaded) | Prose body & chrome: markdown running text, sidebar, TOC, buttons, search |
| **IBM Plex Mono** (weights 400/500/600, unpreloaded) | The **"Machine" voice**: code, version chips, the hero note card, meta lines, and every UPPERCASE apparatus label (home nav, landing eyebrow/feature terms, blog & changelog dates). Drives `--font-mono`. |
| **Archivo** (subset woff2) | Wordmark only — subset to exactly the "ZotLit" glyphs |

Serif carries the editorial voice at **weight 500** for display headings and
**italic** for ledes/standfirsts. Sans carries the **markdown prose body** —
running paragraphs in docs, blog, and the changelog — whose display headings sit
in serif. Inter loads both upright and italic for true `<em>`s beside Gelasio's.

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

## The label voice

Apparatus **labels** — short text that names a thing rather than saying a
sentence — speak the **Machine register: IBM Plex Mono, `uppercase`**, 0.08–0.2em
tracking, weight 500–600. Real uppercase over the bundled mono replaces the old
`all-small-caps` (serif on the marketing surfaces, sans in docs chrome): it
stays razor-legible at any size, including shrunk-down OG cards, where
synthesized small-caps crowd and blur.

Every apparatus label site-wide is mono uppercase:

- Home nav links
- Landing eyebrow, feature terms, and feature links
- Changelog/blog dates and meta lines; version-ledger row labels
- Docs sidebar folder + `links`-prop rows, the TOC "On this page" title, docs
  prose h4, and the command `Copy →` affordance

Docs-chrome labels ride the same voice at a smaller size (~0.72rem) and quieter
weight — micro-apparatus inside the sans body rather than marketing display, but
the same mono-uppercase register.

**Running prose stays in normal case**, even in chrome: full sentences read as
text, not labels — so the v2 banner notice, tooltips, and any
sentence-shaped copy keep their upright case and sans body voice. The Archivo
wordmark likewise stays outside label treatment.

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

### Landing (`src/routes/_home/index.tsx`)

Serif content throughout (the landing is hero + feature index, no markdown
body):

- **Hero, two columns.** Left: orange mono-uppercase eyebrow, serif headline,
  italic lede, the **repo datum** (`src/components/repo-datum.tsx`) — a 2px accent
  left bar (no box) with the official Invertocat mark in accent orange and one
  muted mono line showing slug, stars, and downloads (each stat drops out when
  its fetch is unavailable) — then a "Get started" button + underlined "Read
  the docs" text link. Right: the note mock as a chrome-less paper sheet in
  mono, slight rotation, hard offset shadow, accent bookmark tab at the top
  edge.
- **Features as an index**: four rows — mono-uppercase term, dotted
  leader, mono-uppercase orange link into the docs — with a one-line
  description under each.
- **Shared copyright footer** (`src/components/site-footer.tsx`): hairline-topped
  "© year AidenLx · AGPL-3.0 Licensed" line, shared across all `_home` index
  surfaces (landing, blog index, changelog index).

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
  tracking).
- **`links`-prop entries** sit in muted mono uppercase (0.72rem, weight 500,
  0.08em tracking) — set apart from folders by color and from page links by
  case. The home nav shares this mono-uppercase voice at 0.8125rem.
- **Page links** lead in near-ink (0.84rem, foreground mixed 82% toward ink).
- Active states are stock (tinted pill with `fd-primary` text, guide-line bar
  on nested items).

The mobile header carries the same double-hairline signature as the home nav.

### Docs release availability

Release badges use the mono-uppercase apparatus voice with `NEW`, then
`UPDATED` precedence. An Introduced Release whose Stable Release Line matches
the Docs Release Line becomes the compact orange `NEW` pill. An Updated Release
whose Stable Release Line matches the Docs Release Line becomes a quieter
orange-outline `UPDATED` pill for an existing page.

Every page shows a quiet mono metadata row:
`AVAILABLE SINCE ZotLit <Introduced Release>`. The release links to the
matching Changelog Entry when one exists.

A page with no Introduced Release yet — it hasn't gone through a release
cycle (see ADR 0002) — shows neither the sidebar pill nor the metadata row.
This is a normal, expected state, not an error: Pre-release Docs deploys
continuously from `next`, so an unreleased page can sit on a live site for a
while before the next release assigns it.

### Comments

Mounted via the docs page footer slot after prev/next cards.
`src/components/comments.tsx` renders a lazy Giscus mount (theme follows color
scheme) with no heading of its own — Giscus's live comment-count header is
sufficient.

## CSS architecture

Structural chrome overrides live in the owned layout slots. CSS in
`src/styles.css` is reduced to what CSS alone must do:

- **Tokens** — the `--color-fd-*` palette and `@theme inline` font wiring.
- **`#toc-title`** — the one accepted Fumadocs-shipped anchor (ships with this
  exact id, no className hook). Re-check on bumps.

The docs/blog prose restyle is **not** here. Customize Fumadocs prose through
its **typography element modifiers** (`prose-h2:…`, `prose-blockquote:…`) — the
plugin's own customization surface — never hand-written `.prose`-descendant CSS
in `src/styles.css`. Modifiers carry the `not-prose` escape hatch and win over base
`prose` by layer order, so no unlayered override is needed. The shared set lives
in `src/lib/prose.ts` (`ztProse`), applied on `<DocsBody>` and the blog post. The
fork's modifiers are single-element only; a descendant compound with no modifier
(`li p`, nested lists) uses a Tailwind arbitrary variant (`[&_li_p]:…`) — still
inline, still not `src/styles.css`.
