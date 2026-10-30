---
title: Citation scan — unresolved and malformed
---
# Citation scan — unresolved and malformed

Use the `all` Scope Case and the settings from `citation-scan-forms.md`. The
unknown key below is the Fixture Spec's declared missing-key case. The ambiguous
key and the Attachment in the malformed link already exist in the Fixture.

```sh
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:references file=citation-scan-errors.md
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by citekey=nonexistentCitekeyForSmokeTest2099
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by citekey=duplicateAcross2019
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=DDDD4444
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:cited-by key=GGGG7777g118
packages/scripts/scripts/obsidian-cli.ts vault=<vault> zotlit:annotation-uses key=PUPR5FG5
```

## Unknown Citation Key (final review round)

[@nonexistentCitekeyForSmokeTest2099]

Expected: References explains that the Citation Key names no Item.
`zotlit:references` returns `kind: unresolved` with this `citekey`.
`zotlit:cited-by citekey=…` returns `KEY_NOT_FOUND`. No Item gains a Cited By
occurrence. The popover reports an unresolved key; CitationText keeps the source.
Export fails on the unknown key. Annotation uses has no group for this page.

## Ambiguous Citation Key (final review round)

[@duplicateAcross2019]

Expected: References explains that several Items carry the key.
`zotlit:references` returns `kind: ambiguous`, with candidates `DDDD4444`
(My Library) and `GGGG7777g118` (Lab Archive). `zotlit:cited-by citekey=…`
returns `AMBIGUOUS_CITEKEY` with those candidates. Neither candidate's
`key=` query includes this page. The popover offers the candidates;
CitationText keeps the source. Export fails on ambiguity. Annotation uses
has no group for this page.

## Attachment-only empty link (final review round)

[](zotero://open/library/items/RGRPDF24)

Expected: References shows a malformed Annotation Citation because the URL
has no Annotation key. `zotlit:references` returns `kind: malformed`, with no
`refNumber`. Cited By gains no occurrence; Annotation uses gains none.
There is no resolved Annotation popover or formatted CitationText. Export
preserves the link; Annotation Citation export is deferred to #1684.

The three cases above check #1704: References and the CLI must agree on the
reason, with a readable database. They must keep a failed database read distinct
from a missing Item. Compare these outcomes after the final review round merges.

## Whole-page check

Expected: `zotlit:references` has three entries in source order: `unresolved`,
`ambiguous`, and `malformed`. It has no resolved work. The missing and ambiguous
entries have reference numbers; the malformed entry has none.

This page intentionally fails export because of its Citation Keys. Use
`pandoc-export-scan-pipeline.md` for the successful export checks.
