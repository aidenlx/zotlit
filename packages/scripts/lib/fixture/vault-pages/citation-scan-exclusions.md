---
title: Citation scan — exclusions
hidden-citekey: "[@Hensher2011]"
hidden-wikilink: "[[literatures/Hensher2011]]"
hidden-annotation: "[](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)"
---
# Citation scan — exclusions

Use the settings from `citation-scan-forms.md`. Read this page in Source mode
to inspect hidden inputs. Each excluded region below holds a real Fixture key,
a Literature Note link, and a Durable Annotation Link.

For each excluded region, the expected outcome is the same: zero added
occurrences in References, Cited By, `zotlit:references`, `zotlit:cited-by`, and
`zotlit:annotation-uses`. CitationText adds no formatted citation. Reading view
has no citation popover for hidden text; visible code remains literal. Export
adds no bibliography entry from these regions and removes Obsidian comments.

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=citation-scan-exclusions.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by citekey=Hensher2011
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=RUGIER24
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

Expected: Hensher's Cited By answer and the Annotation uses answer have no group
for this page. Rougier has only the three visible cases at the end of the page.

## Frontmatter

Inspect the three `hidden-` properties at the top of this file.

Expected: all three properties contribute zero citations and zero Annotation
Occurrences. The frontmatter key is ordinary metadata, not an export `nocite`.

## Inline code

`[@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)`

Expected: the inline code contributes zero occurrences on all listed surfaces.

## Fenced code

```md
[@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)
```

Expected: the fenced code contributes zero occurrences on all listed surfaces.

## Indented code

    [@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)

Expected: the indented code contributes zero occurrences on all listed surfaces.

## Inline math

$x + [@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)$

Expected: the math contributes zero occurrences on all listed surfaces.

## Display math

$$
x + [@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)
$$

Expected: the math contributes zero occurrences on all listed surfaces.

## HTML comment

<!-- [@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1) -->

Expected: the HTML comment contributes zero occurrences on all listed surfaces.

## Inline Obsidian comment

Visible text %% [@Hensher2011] [[literatures/Hensher2011]] [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1) %% continues here.

Expected: the comment contributes zero occurrences on all listed surfaces.

## Multiline Obsidian comment

%%
[@Hensher2011]
[[literatures/Hensher2011]]
[](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)
%%

Expected: the comment contributes zero occurrences on all listed surfaces.

## Comment inside a Citation Cluster (final review round)

[@rougierTenSimpleRules2014 and %% @Hensher2011 %%]

This is the Fixture spelling of `[@a and %% @hidden %%]`.

Expected: References, Cited By, and both citation CLI commands count only
Rougier. The citation popover and CitationText contain no hidden key or comment
markers. Export cites only Rougier. Annotation uses gains no occurrence.

## A price is prose

The figure costs $5 and [@rougierTenSimpleRules2014] explains its design for $6.

Expected: all citation surfaces count one Rougier occurrence; the prices remain
prose. Annotation uses gains no occurrence.

## An escaped dollar is prose

The symbol \$ precedes [@rougierTenSimpleRules2014].

Expected: all citation surfaces count one Rougier occurrence. Annotation uses
gains no occurrence. The whole page has one resolved work and three occurrences.
