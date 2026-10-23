---
title: Citation scan — Annotation uses
---
# Citation scan — Annotation uses

Use the settings from `citation-scan-forms.md`. Every link below names the
existing Annotation `PUPR5FG5`, “Identify Your Message”, on page “1” of
Attachment `RGRPDF24`. Its parent Item is `RUGIER24` (Rougier).

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=citation-scan-annotations.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=RUGIER24
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

Inspect this page's group in vault-wide results. The Annotation Indexed Key is
`PUPR5FG5`; the Attachment key and parent Item key select different objects.

## Exactly empty text

[](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)

Expected: References and `zotlit:references` cite Rougier at page “1”. Cited By
and `zotlit:cited-by` add one `annotation` occurrence. Annotation uses adds one
`citation` form, with empty `text`. Hover shows the Annotation's text and page.
CitationText includes the parent citation with locator “1”; direct link
rendering belongs to #1678. Export preserves this link unchanged (#1684).

## Angle-bracket destination

[](<zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1>)

Expected: the same outcomes as the exactly-empty case, including one more
`citation` use and the page locator. Export preserves the angle-bracket spelling.

## Labelled link

[p. 1](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)

Expected: Annotation uses adds one `labelled` form, with `text` equal to `p. 1`.
The Annotation popover shows the quoted text and page. References, Cited By,
both citation CLI commands, and CitationText gain no citation. Export keeps the link.

## Whitespace-only label

[ ](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)

Expected: the same outcomes as the labelled case. Annotation uses reports
`labelled` and preserves exactly one space in `text`.

## Autolink

<zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1>

Expected: the same outcomes as the labelled case. Annotation uses reports
`labelled`, with the URI as `text`; it adds no parent citation.

## Embed

![](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)

Expected: Annotation uses adds one `embed` form, with empty `text`. References,
Cited By, both citation CLI commands, and CitationText gain no citation. Export
keeps the embed. Its visual rendering and interaction belong to #1678.

## Whole-page check and source choice

Expected: References has one resolved work, Rougier, with two Annotation
Citations at page “1”. Cited By has two occurrences from this page. Annotation
uses has six occurrences in source order: `citation`, `citation`, `labelled`,
`labelled`, `labelled`, `embed`. Compare each returned position with its link.

Turn off Annotation Citations. Expected: References has no entries from this
page, and Cited By omits both citations. Both citation CLI commands report
`annotation` in `omittedSyntaxes`. Annotation uses still reports all six uses.
CitationText omits the two citations; their source links remain. Export keeps
all links. Restore the setting.

## Edit and query immediately (final review round)

Copy the following link from its code block to a new paragraph at the end of
this page. Save and immediately run all three CLI commands above.

```md
[](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1)
```

Expected: References and Cited By reach three occurrences from this page.
Annotation uses reaches seven. A command waits for the edit or reports
`INDEX_NOT_READY`; it must not report complete coverage with the old count.
CitationText then includes the new page “1” citation. Export preserves its link.
This is S3. Remove the added paragraph and check that counts return to two and six.

Rename this page, then query Annotation uses and Cited By. Expected: the group
moves to the new path with the same counts. Restore the name. In a disposable
copy, delete the page: both groups disappear. Rebuild the Fixture to restore it.
