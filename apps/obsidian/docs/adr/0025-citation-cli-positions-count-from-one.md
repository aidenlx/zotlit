# Citation CLI positions count from 1

Both citation commands (`zotlit:cited-by`, `zotlit:references`) report every
Citation Occurrence with `line` and `col` counting from 1, while `offset` keeps
counting UTF-16 code units from 0, start inclusive and end exclusive. The
re-basing happens once, at the CLI envelope, so the Citation Index, the
occurrence scanner, and both sidebars keep the 0-based `Pos` Obsidian itself
works in. An agent reaches a reported position through editors, `rg
--line-number --column`, and `sed -n`, which all count from 1, so a 0-based
answer is misread far more often than it is converted; `offset` addresses the
file's text rather than a screen, so re-basing it would break the fragment
length `end.offset - start.offset` and match no tool anyway; and holding the
divergence at the wire boundary leaves one convention inside the plugin, where
a position is handed straight back to Obsidian.

## Consequences

- The CLI contract diverges from the platform convention it is built on, so the
  Citations Guide states the base in its `position` row rather than leaving an
  agent to infer it from Obsidian's own documentation.
- `col` counts UTF-16 code units while `rg --column` counts bytes, so the two
  agree only on an ASCII line. The guide carries that caveat beside the base.
- Plugin-internal code stays 0-based: a position that reaches a `MarkdownView`,
  an `EditorPosition`, or the Cited By and References Sidebars needs no
  conversion back. The first-occurrence order `zotlit:references` sorts its
  entries into keys on `offset`, which the re-basing leaves untouched.
- `contractVersion` stays 1: the base changed before contract version 1 had a
  published consumer, so no version of the wire format ever answered 0-based.
