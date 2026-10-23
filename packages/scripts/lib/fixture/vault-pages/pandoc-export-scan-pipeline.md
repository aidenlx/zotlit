---
title: Pandoc export — scan pipeline
lang: en-GB
---
# Pandoc export — scan pipeline

Use the settings from `citation-scan-forms.md`. Run **ZotLit: Export note with
citations** on this whole page. Use built-in export, whose adapter reads the
worker's parse. The short symbolic input in the spec uses `a`; here it names
the existing Rougier Item. The unclosed display-math case is on
`pandoc-export-unclosed-math.md`.

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=pandoc-export-scan-pipeline.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=RUGIER24
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by citekey=Hensher2011
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

Expected for the whole page: export succeeds and its bibliography contains
only Rougier. References and its CLI command show one resolved work with two
occurrences. Cited By and its CLI command show those two occurrences for this
page. Hensher and Annotation uses have no group for this page. CitationText and
citation popovers use only the two visible Rougier citations.

## Comment between key and following text (final review round)

[@rougierTenSimpleRules2014%% hidden %%b]

Expected: export cites `rougierTenSimpleRules2014`, removes the comment, and
keeps the following `b` as text. It must not fail on a newly joined key ending
in `2014b`. References, Cited By, their CLI commands, the popover, and CitationText
count one Rougier citation. This is S1's `[@a%% hidden %%b]` case.

## Fence nested in a callout

> [!note] Literal citation example
> ```md
> [@Hensher2011]
> [[literatures/Hensher2011]]
> [](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)
> ```

Expected: export keeps a code block with literal examples and adds no work
from it. References, Cited By, both citation CLI commands, CitationText, and
Annotation uses gain zero occurrences. Reading view shows code, with no
citation popover for its contents.

## Fence on a list-marker line

1. First item.
2. ~~~md
   [@Hensher2011]
   ~~~
3. Third item cites [@rougierTenSimpleRules2014].

Expected: export has exactly three ordered-list items, numbered 1, 2, and 3.
The second item holds literal code; the third cites Rougier. No extra list item
appears when export separates the fence from surrounding text. References,
Cited By, their CLI commands, the popover, and CitationText count only the third
item's Rougier citation. Annotation uses gains no occurrence.
