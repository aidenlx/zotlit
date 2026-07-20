# ZotLit docs site — design spec

Theme: **"Manuscript & Machine"** — cream ground, navy ink, deep-orange accent.
One token system (`--color-fd-*` overrides in `app/global.css`) drives all
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

- `layouts/home/slots/header.tsx` — home nav: caps-rule links, double hairline.
- `layouts/docs/slots/sidebar.tsx` — docs sidebar: orange rubric on folder
  rows, muted small-caps `links`-prop entries, near-ink page links.
- `layouts/docs/page/slots/footer.tsx` — prev/next cards: muted direction
  label over the title. Exports `FooterCards` for reuse on blog posts.
- `components/docs-subnav.tsx` — mobile docs header with the hairline
  signature (`DocsLayout slots.header`).
- `components/banner.tsx` — vendored fumadocs `Banner`: `height` is a floor
  (`min-height`), so the strip wraps instead of overflowing on narrow
  viewports, and a resize-synced `--fd-banner-height` keeps sticky offsets
  tracking the wrapped height. Consumed by `components/legacy-banner.tsx`.

## Type system

Four faces, four roles:

| Face | Role |
| --- | --- |
| **Gelasio** (serif) | Content & display: headings, titles, descriptions/ledes/standfirsts, small-caps labels, feature list, editorial annotations |
| **Inter** (sans, `preload: false`) | Prose body & chrome: markdown running text, nav, sidebar, TOC, buttons, search |
| **Mono** (system stack) | Code, version chips, the hero note card |
| **Archivo** (subset woff2) | Wordmark only — subset to exactly the "ZotLit" glyphs |

Serif carries the editorial voice at **weight 500** for display headings and
**italic** for ledes/standfirsts. Sans carries the **markdown prose body** —
running paragraphs in docs, blog, and changelog detail — whose h1–h3 headings
sit in serif. Inter loads both upright and italic for true `<em>`s beside
Gelasio's.

The `.zt-prose` heading scale sits one notch above Fumadocs' stock sizes to
compensate for Gelasio's smaller x-height (~0.48em vs Inter's ~0.55em).
Blockquotes at 1.125em put Gelasio at optical parity with the surrounding
sans body.

## The caps rule

The rule scopes to **labels** — short apparatus that names a thing rather than
saying a sentence. Every label site-wide uses `font-variant-caps:
all-small-caps` — uniform small-capital height, no tall initials — plus
0.07–0.1em tracking:

- Nav links
- Sidebar root-level rows (folders and `links`-prop entries)
- TOC "On this page" title
- Docs prose h4 (minor heads as apparatus labels, in sans)
- Landing feature terms and eyebrow
- Changelog/blog dates and meta lines

**Running prose stays in normal case**, even in chrome: full sentences read as
text, not labels — so the v2-beta banner notice, tooltips, and any
sentence-shaped copy keep their upright case and sans body voice. The Archivo
wordmark likewise stays outside caps treatment.

## Font loading

All loaders sit in the root layout; families are assigned in the `@theme
inline` block in `app/global.css`. Gelasio preloads app-wide (paints on every
route). Inter is `preload: false` — fetched only where sans paints, swapping
shift-free from a metric-adjusted fallback on serif-only routes.

## Per-surface

### Landing (`app/(home)/page.tsx`)

Serif content throughout (the landing is hero + feature index, no markdown
body):

- **Hero, two columns.** Left: orange all-small-caps eyebrow, serif headline,
  italic lede, the **repo datum** (`components/repo-datum.tsx`) — a 2px accent
  left bar (no box) with the official Invertocat mark in accent orange and one
  muted mono line showing slug, stars, and downloads (each stat drops out when
  its fetch is unavailable) — then a "Get started" button + underlined "Read
  the docs" text link. Right: the note mock as a chrome-less paper sheet in
  mono, slight rotation, hard offset shadow, accent bookmark tab at the top
  edge.
- **Features as an index**: four rows — all-small-caps serif term, dotted
  leader, all-small-caps orange link into the docs — with a one-line
  description under each.
- **Shared copyright footer** (`components/site-footer.tsx`): hairline-topped
  "© year AidenLx · MIT Licensed" line, shared across all `(home)` index
  surfaces (landing, blog index, changelog index).

### Changelog (`/changelog`)

List/detail pages in the `(home)` route group styled with Tailwind over fd
tokens. Each release: right-aligned gutter (all-small-caps date, mono version
badge; latest badge orange-bordered) and a body with serif heading, optional
companion note, then bullet notes in serif digest density. The detail page
renders full release notes as `zt-prose` (sans body with serif headings).
Changelog is not indexed in search.

### Blog (`/blog`)

The changelog's sibling in the `(home)` route group:

- **Index**: two-column annals grammar — gutter with date/byline; body with
  serif title, italic deck, orange "Read the post →" link. Closes on the
  shared `SiteFooter`.
- **Post head**: "← Blog" caps crumb, serif title, italic standfirst,
  all-small-caps meta line, hairline, then `zt-prose` body.
- **Post tail**: `FooterCards` prev/next, then comments (Giscus).

### Docs content column

- Title: serif, medium weight, balanced.
- Description: serif italic.
- Prose (`.zt-prose`): sans body, serif h1–h3 at weight 500 with balance and
  the compensated scale, h4 as sans all-small-caps label, inline code
  square-cornered, `kbd` mono.
- Blockquotes and figcaptions carry the serif-italic editorial register.
- Lists run tighter than paragraphs (0.75em block margins, 0.25em item gaps).
- **Command references** (`components/command.tsx`): leading Lucide `Terminal`
  glyph (accent) + command name in serif display voice + a `Copy →` caps link.
  Block form rules a hairline; inline form is glyph + underlined name only.

### Docs chrome (sidebar)

Sans throughout. The sidebar keeps Fumadocs' stock shapes (rounded rows,
tinted active pill, indent guides) via the owned slot; the type carries:

- **Folder rows speak orange caps** at the TOC-title register (0.88rem, weight
  500, wide tracking).
- **`links`-prop entries** sit in muted small-caps (0.9375rem, weight 500,
  0.06em tracking) — set apart from folders by color + tracking and from page
  links by case. The home nav renders the same voice at 1.125rem.
- **Page links** lead in near-ink (0.84rem, foreground mixed 82% toward ink).
- Active states are stock (tinted pill with `fd-primary` text, guide-line bar
  on nested items).

The mobile header carries the same double-hairline signature as the home nav.

### Comments

Mounted via the docs page footer slot after prev/next cards.
`components/comment.tsx` renders a lazy Giscus mount (theme follows color
scheme) with no heading of its own — Giscus's live comment-count header is
sufficient.

## CSS architecture

Structural chrome overrides live in the owned layout slots. CSS in
`app/global.css` is reduced to what CSS alone must do:

- **Tokens** — the `--color-fd-*` palette and `@theme inline` font wiring.
- **`.zt-prose`** — the docs prose restyle, anchored to `.zt-prose` on
  `<DocsBody>`. Unlayered rules beat Fumadocs' `@layer utilities` without
  `!important`. Every rule carries a `:not(:where(.not-prose, .not-prose *))`
  guard mirroring Fumadocs' escape hatch.
- **`#toc-title`** — the one accepted Fumadocs-shipped anchor (ships with this
  exact id, no className hook). Re-check on bumps.
