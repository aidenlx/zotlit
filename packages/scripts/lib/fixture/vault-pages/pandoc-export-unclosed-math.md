---
title: Pandoc export — unclosed display math
lang: en-GB
---
# Pandoc export — unclosed display math

Use the settings from `citation-scan-forms.md`. Run **ZotLit: Export note with
citations** on this whole page. Use built-in export, whose adapter reads the
worker's parse.

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=pandoc-export-unclosed-math.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=RUGIER24
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by citekey=Hensher2011
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

## Unclosed display math runs to the end of the note (final review round)

The next input deliberately has no closing math fence. Keep the blank line
between the two bracketed lines. This is S1's `$$\n[@hidden]\n\n[@a]` case;
here the keys name the existing Hensher and Rougier Items.

Expected: References and the CLI show no citation from the `$$` line to the
end of the note. The whole page has zero citations. Cited By and its CLI command
have no group for this page for either Item. CitationText and citation popovers
show no citation, and Annotation uses gains no occurrence.

Built-in export succeeds with no citation and does not fail on either
`Hensher2011` or `rougierTenSimpleRules2014`. Neither Item appears in the
bibliography (final review round).

$$
[@Hensher2011]

[@rougierTenSimpleRules2014]
