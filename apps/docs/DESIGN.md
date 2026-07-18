# ZotLit docs site — design spec

Theme: **"Manuscript & Machine"** — cream ground, navy ink, deep-orange accent
(palette tokens in `app/global.css`, rationale in `docs/brand.md`). One token
system drives all three surfaces: landing, changelog, docs. This spec covers
the type system and the layout devices that carry it; it matches the shipped
implementation.

## Mechanism: build on the Fumadocs theme

Every visual decision is expressed through Fumadocs' sanctioned
customization surface: the `--color-fd-*` token set, layout props, and —
where the signature needs structure — app-owned **layout slots**. The
editorial palette is the site theme, implemented as a full `--color-fd-*`
override in `app/global.css` after the preset import — light values in
`:root`, dark in `.dark` — so `/docs` (sidebar, search, cards) sits on the
cream ground too. Chrome that carries editorial devices is owned as code,
ejected from the Fumadocs registry (`fumadocs customize` / `fumadocs add`,
config in `cli.json`) and wired back through the `slots` prop:

- `layouts/home/slots/header.tsx` — the home nav (`HomeLayout
  slots.header`): caps rule on nav links, double hairline under the header.
- `layouts/docs/slots/sidebar.tsx` — the docs sidebar (`DocsLayout
  slots.sidebar`): the orange rubric on page-tree root rows (folder
  triggers/links), the muted small-caps `links`-prop entries above it
  (`SidebarLinkEntry`, one voice with the home nav), and the near-ink page
  links beneath.
- `layouts/docs/page/slots/footer.tsx` — the prev/next footer cards
  (`DocsPage slots.footer` via `components/docs-page-footer.tsx`): a muted
  direction label over the title, no chevrons or description line. Exports
  the presentational `FooterCards` so blog posts render the same device
  outside the docs tree context.
- `components/docs-subnav.tsx` — thin wrapper over the stock docs mobile
  header adding the hairline signature (`DocsLayout slots.header`).

Ejected slots vendor only their own file; everything they import stays on
package entry points (`fumadocs-ui/components/sidebar/*`,
`fumadocs-ui/components/ui/*`, …), so upstream keeps maintaining the
primitives. Re-diff the vendored slots against upstream on fumadocs bumps.
(`fumadocs-ui` is aliased to `@fumadocs/base-ui`; its CSS/theming/layout
surface is identical, and the CLI's `base-ui` registry serves it
first-class.)

The nav is the `HomeLayout` with the owned header slot: Docs / Changelog /
Blog / GitHub via the `links` prop in `lib/layout.shared.tsx`; fd tokens already
give ink links with orange hover/active. Search, theme switch, and the
mobile menu stay upstream-maintained through the package imports inside the
slot.

## Type roles

Four faces, four roles:

| Face | Loader | Role |
| --- | --- | --- |
| **Gelasio** (serif) | `next/font/google`, root layout | Content: hero, feature list, changelog entries, docs title/description/prose |
| **Inter** (sans) | `next/font/google`, root layout, `preload: false` | Chrome: nav, sidebar, TOC, buttons, chips, search |
| **Mono** (system stack) | Tailwind `--font-mono` | Code, version chips, the hero note card |
| **Archivo** (subset woff2) | `next/font/local`, root layout | Wordmark only — the file is subset to exactly the "ZotLit" glyphs |

Display headings (hero h1, changelog h1, docs title, prose h1–h3) sit at
**weight 500**. Descriptions and subtitles are **serif italic**. Prose body is
serif at 1.75 line-height.

## The caps rule

Every label site-wide uses `font-variant-caps: all-small-caps` — uniform
small-capital height with **no tall initials** — plus 0.07–0.1em tracking:

- nav links (`navItemVariants` in `layouts/home/slots/header.tsx`)
- sidebar root-level rows — folder labels and `links`-prop entries
  (`layouts/docs/slots/sidebar.tsx`)
- TOC "On this page" title (`#toc-title`)
- docs prose `h4` (minor heads read as apparatus labels, in sans)
- landing feature terms (`dt`) and section refs/eyebrow
- changelog dates
- blog dates and post meta lines (index gutter; the "date · by author" line
  under a post's standfirst)

The Archivo wordmark stays outside any caps treatment: synthesized small-caps
would fall back to other faces and mangle the lockup.

## Per-surface

### Landing (`app/(home)/page.tsx`)

Serif content (`font-serif` on the `HomeLayout`), custom page content
composed inside the stock layout with Tailwind over fd tokens:

- **Hero, two columns.** Left: orange all-small-caps eyebrow
  "Zotero × Obsidian", serif headline, the pitch as an italic lede, navy
  filled "Get started" button (orange on hover) + underlined "View on
  GitHub" text link. Right: the note mock as a chrome-less paper sheet —
  mono content (frontmatter with citekey/year/zotero link, heading,
  orange-barred highlight quote, own-note line), rotated ≈ −0.8°, hard
  offset shadow, and an orange bookmark tab (V-notch, echoing the logo)
  hanging over its top edge.
- **Features as an index**: four rows — all-small-caps serif term, dotted
  leader, all-small-caps orange link into the docs (Tutorial → /
  How-to →) — with a one-line description under each.
- **Requirements live only in the footer**: left "ZotLit · free & open
  source", right "Requires Zotero 9+ · Obsidian desktop". The hero carries
  nothing about platform or license.

### Changelog (`/changelog`) — "Margin Annals"

List/detail pages are hand-written markup in the `(home)` route group styled
with Tailwind over fd tokens — `DocsPage` is never used outside `/docs`.
Page head with italic standfirst; each release is a two-column row:
right-aligned gutter (all-small-caps date above a mono version badge; the
latest badge is orange-bordered) and a body that leads with a one-sentence
summary as the heading, then an optional italic "✝ Companion x.y.z released
alongside." note, then the bullet notes. The detail page
(`/changelog/[version]`) has a "← Changelog" crumb, version heading with a
`latest` badge when applicable, date, companion note, summary, notes, and a
bordered "Open release on GitHub ↗" link. The changelog collection is not
indexed in search.

### Blog (`/blog`) — "Margin Annals II"

The blog is the changelog's sibling: like it, list/detail pages are
hand-written markup in the `(home)` route group styled with Tailwind over fd
tokens, and Blog joins the nav `links`.

- **Index** reuses the annals grammar essay-sized: page head with italic
  standfirst, then each post as a two-column row — right-aligned gutter with
  an all-small-caps date over an italic "by author" byline; body with serif
  title, italic deck, and an orange all-small-caps "Read the post →" link.
- **Post head is the docs page head verbatim** ("quiet manuscript"): a
  "← Blog" caps crumb, serif title, italic standfirst, an all-small-caps
  "date · by author" meta line, one hairline, then serif prose. No category
  kickers.
- **Post tail: prev/next, then comments.** The owned prev/next footer cards
  (`FooterCards` from the footer slot) — the same component `/docs` pages
  render, so the device is shared across surfaces — followed by the docs'
  "Ruled Section" comments (Giscus). There is no "discuss on GitHub" link.

### Docs content column — "quiet manuscript"

- `DocsTitle`: `font-serif text-4xl leading-[1.16] font-medium text-balance`
- `DocsDescription`: `font-serif text-lg italic`
- Prose: serif body, h2/h3 at weight 500, h4 as sans all-small-caps label,
  inline code square-cornered (`border-radius: 0`), `kbd` pinned to mono.
- Even, restrained scale — sections carry no extra devices (rules, counters,
  or oversized openers).

### Docs chrome — apparatus

Sans throughout. The sidebar keeps fumadocs' stock shapes (rounded rows,
tinted active pill, indent guides) via the owned sidebar slot; the type
carries a **uniform rubric over a receding apparatus**:

- **Page-tree root speaks orange caps.** Every folder trigger and folder
  link is accent all-small-caps at the TOC-title voice: `0.88rem`, weight
  500, `0.1em` tracking.
- **`links`-prop entries carry the shared links voice.** Changelog, Blog and
  the like sit above the tree in muted small-caps (`fd-muted-foreground`, no
  orange) at `0.9375rem` weight 500 / `0.06em` tracking, leading icon kept
  (`SidebarLinkEntry`, isolated from the page-tree's `SidebarItem`) — set
  apart from the orange folder rubric by color + tracking, and from the page
  links by case. The home nav renders the same voice at a larger `1.125rem`,
  same `0.06em` tracking, icon dropped on desktop (the mobile drawer keeps
  it). The medium weight carries the muted grey — at the default weight it
  read too thin next to the orange it replaced.
- **Nested page links lead in near-ink**: `0.84rem`, foreground mixed 82%
  toward ink (`color-mix` of `fd-foreground`/`fd-muted-foreground`) — ahead
  of the rubric inside the sidebar, still deferring to the prose column.
- **Chevrons stay muted** — the marks don't join the rubric.
- Active states are stock: the tinted pill with `fd-primary` text, plus the
  guide-line bar segment on nested items.

The mobile header (`components/docs-subnav.tsx`) carries the same offset
double-hairline signature as the home nav.

### Doc-page comments — "Ruled Section"

Mounted via `DocsPage`'s footer slot so the section closes the page after
the prev/next cards. `components/comment.tsx` owns the mount (both the docs
footer and the blog post tail render it, so the surfaces stay identical) and
adds no heading of its own: the lazy Giscus mount stands alone (theme follows
the color scheme), framed only by its own "N reactions / N comments / input"
layout. The site deliberately skips a kicker or hint so nothing duplicates
Giscus's live comment-count header.

## Font loading architecture

Each loader lives in the layout that owns its paint scope; families are
assigned in exactly one place — the `@theme inline` block in `app/global.css`
(`--font-sans` → Inter, `--font-serif` → Gelasio, `--font-brand` → Archivo).

- All three loaders sit in the **root layout** and expose CSS variables on
  `<html>`. Serif paints on every route, so Gelasio preloads app-wide.
- **Inter is `preload: false`**: its variable is defined everywhere, but the
  font is only fetched where sans actually paints. Chrome-light pages swap
  shift-free from the metric-adjusted "Inter Fallback".
- `@theme inline` (not plain `@theme`) is load-bearing: theme variables that
  reference other CSS variables must resolve at point of use.

## Overriding fumadocs

Structural chrome overrides live in the owned layout slots (see Mechanism);
CSS in `app/global.css` is reduced to what CSS alone must do:

- **Tokens** — the `--color-fd-*` palette and `@theme inline` font wiring.
- **`.zt-prose`** — the docs prose restyle, anchored to our own class set on
  `<DocsBody className="zt-prose">`. Markdown descendants (headings, code,
  kbd) are only reachable from CSS. fumadocs ships its prose styles inside
  `@layer utilities` and never sets a `font-family`, so these are
  **unlayered rules** — unlayered CSS beats layered CSS regardless of
  specificity, no `!important` needed. Anchoring to our own class (not
  `.prose`) keeps the TOC, whose items also carry `prose`, on sans.
- **`#toc-title`** — the one accepted fumadocs-shipped anchor: the TOC
  label ships with this exact id and exposes no className hook short of
  ejecting the whole TOC slot. Re-check on fumadocs bumps.

## Decisions

The mechanism, palette, nav, home, changelog, and comments designs come from
the site-plumbing prototyping round
(`.scratch/docs-site-v2/issues/01-site-plumbing.md`, 2026-07-17; assembled
mock `01-design-mock.html`). The type system below comes from a later
prototype grilling the same day, which superseded two of that issue's calls:
serif was widened from `(home)`-only to all content (including docs prose),
and tall-initial `small-caps` gave way to `all-small-caps`.

Verdicts from the type grilling, each chosen against four live alternatives:

1. **Allocation — Manuscript & Machine.** Serif content with sans chrome
   closes the landing/docs gap while keeping navigation scannable. Full-serif
   chrome hurt sidebar legibility at 13–14px; sans-body options left the bulk
   of docs pages in a different voice than the landing.
2. **Chrome voice — uniform small caps.** The tall-initial `small-caps` form
   is banned site-wide; `all-small-caps` keeps the editorial label device the
   landing already used (eyebrow, refs) without the mixed-height look.
3. **Docs content — quiet manuscript.** Chapter rules, numbered sections,
   italic subheads, and magazine openers were all rejected as devices that tax
   dense reference pages; hierarchy comes from the serif scale alone.
4. **Content labels follow the chrome verdict.** One caps rule everywhere
   beats a content/chrome split — feature terms and changelog dates use the
   same uniform form.

A later sidebar-tree grilling (same day, rounds 5–7 in the same prototype
artifact) resolved the page-tree voice, superseding the earlier
"folders caps, page links plain, both muted" treatment:

5. **Tree voice — receding apparatus, rubricated.** Chosen over the live
   as-built state, the artifact's ink-caps density, a caps-everything root,
   and a muted overline form: page links darken toward ink and lead; folder
   caps shrink to the TOC-title register and take the accent orange, echoing
   the landing's section refs.
6. **Rubric reach — uniform at root.** _(superseded by 11.)_ Changelog (a
   `links`-prop entry) joins the orange caps voice rather than sitting as a
   lone plain link between caps rows; scale stays at the TOC voice rather
   than the larger nav-link carrier, and the rubric colors the text, not a
   tick marker.
7. **States stay stock.** Grey-vs-warm hover was moot (`fd-accent` already
   maps to the warm accent paper); ink-flipped active caps and full-ink page
   links were rejected — one active grammar everywhere, and the sidebar
   defers to the prose column.

A blog grilling (2026-07-17, rounds 8–10 in the same prototype artifact)
designed the `/blog` surface:

8. **Blog index — Margin Annals II.** The changelog's two-column gutter
   grammar, essay-sized, chosen over a newspaper front page with lead story,
   a dotted-leader archive, offset-shadow paper-sheet cards, and a
   full-excerpt journal — blog and changelog read as one family of annals.
9. **Post head — quiet manuscript.** A post is a docs page with a date;
   one head grammar site-wide. Chosen over carrying the index gutter down
   the article, a centered essay head with asterism, a kicker + byline-bar
   front-page article (which would have added a category taxonomy), and a
   compact single-line head.
10. **Post tail — prev/next, then comments.** Navigation before discussion:
    one prev/next device shared with `/docs` — the footer slot was ejected
    and restyled to the prototype's card (muted direction label over the
    title) so both surfaces stay consistent — then the Ruled Section Giscus
    mount. The bordered "discuss on GitHub" colophon and ceremonial asterism
    close were rejected.

A links-unification grilling (2026-07-18, rounds 11–13 in the same prototype
artifact) split the `links`-prop entries back out of the tree rubric so they
read as one voice across the home nav and the docs sidebar:

11. **`links` entries take their own muted voice.** Superseding 6: Changelog
    and Blog no longer borrow the orange folder caps — indistinguishable from
    page-tree sections — but sit in `fd-muted-foreground` all-small-caps,
    apart from the folder rubric by color + tracking and from the page links
    by case. Chosen over a footer utility rail, a boxed-chip cluster, a tinted
    "jump to" shelf, and keeping the orange caps with a leading arrow.
12. **One voice, tracking splits by axis.** _(superseded by 14.)_ Nav and
    sidebar share face/case/color at `0.9375rem` weight 500; tracking is the
    only per-surface tell — compact `0.02em` in the horizontal nav (labels
    read as words), medium `0.06em` in the airier sidebar column.
13. **Icon rides the surface, not the datum.** The leading icon stays in the
    sidebar and drops in the nav — the `links` entry is unchanged; each
    surface renders what suits it. `SidebarLinkEntry` isolates the links voice
    from the page-tree's shared `SidebarItem` so the two never re-merge.
14. **Size splits by axis instead of tracking.** A same-day follow-up: the
    nav voice reads too tight at the sidebar's `0.02em`, so tracking unifies
    to `0.06em` on both surfaces and the horizontal nav differentiates on
    size instead (`1.125rem` vs. the sidebar's `0.9375rem`).
