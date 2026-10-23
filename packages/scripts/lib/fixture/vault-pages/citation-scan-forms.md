---
title: Citation scan — forms and links
---
# Citation scan — forms and links

Walk the Pandoc and wikilink cases from #1683. Use the `all` Scope Case. Turn on
Pandoc Citations, Wikilink Citations, Annotation Citations, and Show Formatted
Citations. Install the Pandoc Engine. Compare Live Preview with Reading view.

For each case, check References here. Open the cited Literature Note to check
Cited By, then return here and hover the citation. CitationText should keep the
case's mode, prefix, suffix, and locator. Run **ZotLit: Export note with citations**
to compare the exported citation. These cases create no Annotation Occurrences.

Run the commands through the repository's Obsidian CLI client, with the vault
selected first. Replace `<vault>` with the Development Vault's name:

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=citation-scan-forms.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=RUGIER24
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=FFFF6666g4200309
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

Expected: References and `zotlit:references` group repeated citations under one
entry per Item. Cited By and `zotlit:cited-by` retain each occurrence from this
page. `zotlit:annotation-uses` has no group for this page. Inspect this page's
group in vault-wide answers; other Fixture pages cite the same works.

## Single key

Figures carry the argument [@rougierTenSimpleRules2014].

Expected: References and Cited By count one Rougier occurrence; the popover,
CitationText, and export show one normal citation.

## Several Items

Two papers support the discussion [@rougierTenSimpleRules2014; @ioannidisWhyMost2005].

Expected: References and Cited By count one occurrence for each Item; the
popover, CitationText, and export keep both Items in one Citation Cluster.

## Prefix, suffix, and locator

Read the advice [see @rougierTenSimpleRules2014, p. 1, for context].

Expected: References and Cited By count Rougier once; the popover, CitationText,
and export retain the prefix “see”, page locator “1”, and suffix “for context”.

## Author-in-text

@rougierTenSimpleRules2014 explains how to choose a figure's message.

Expected: References and Cited By count Rougier once; the popover, CitationText,
and export use Author-in-text mode.

## Suppressed author

Rougier and colleagues explain the method [-@rougierTenSimpleRules2014, p. 1].

Expected: References and Cited By count Rougier once; the popover, CitationText,
and export suppress the author and retain page “1”.

## Wikilink with a Citation Fragment

The same advice appears in [[literatures/rougierTenSimpleRules2014#cite:prefix=see&locator=1&suffix=for%20context]].

Expected: References and Cited By count one wikilink occurrence for Rougier.
The popover, CitationText, and export match the prefix, suffix, and locator case.

## No-break space in a wikilink (final review round)

The group paper is [[Scan target]].

The space inside this link is U+00A0. The file `Scan target.md` has an ordinary
U+0020 space. Open the link and confirm that Obsidian reaches that file.

Expected: References, Cited By, both citation CLI commands, the popover,
CitationText, and export resolve `FFFF6666g4200309`, with citekey
`sharedReadingBeta2022`. The CLI occurrence's `raw` linkpath is `Scan target`.
This is S4; compare it again after the final review round merges.

## Trailing backslash in a wikilink (final review round)

The same group paper is [[Scan target\]].

There is one backslash before the closing brackets. Open the link and confirm
that Obsidian reaches `Scan target.md`.

Expected: all citation surfaces resolve the same Item as the no-break-space
case. The CLI occurrence's `raw` linkpath is `Scan target`, with no backslash.
References has one entry for the group paper, with two wikilink occurrences.

## Whole-page check

Expected: `zotlit:references` has three resolved entries: Rougier with six
occurrences, Ioannidis with one, and the group paper with two. Export has the
same three works. A numeric style assigns one reference number to each work.

Turn off Wikilink Citations and repeat both citation CLI commands. Expected:
the Rougier wikilink and both group-paper occurrences are omitted. References
keeps Rougier's five Pandoc occurrences and Ioannidis's one. The CLI reports
`wikilink` in `omittedSyntaxes`; export keeps its own membership. Restore the
setting before continuing.
