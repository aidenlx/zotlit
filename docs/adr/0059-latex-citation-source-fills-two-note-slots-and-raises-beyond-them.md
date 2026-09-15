# LaTeX citation source fills two note slots and raises beyond them

The `tex_cite` Liquid filter and the matching `texCite` Eta helper accept the `zt.citations` array and produce one LaTeX citation command. Both call one pure serializer in `@zotlit/templates`, beside the Pandoc serializer [ADR 0029](0029-pandoc-citation-formatting-uses-one-complete-serializer.md) describes. A template author reaches LaTeX source without hand-writing a key loop.

One helper covers both of obsidian-zotero-integration's `latex` and `biblatex` formats. They differ only in the control word they cite with, so the helper takes that word as its argument and defaults to `cite`. The word is written without its backslash and may be starred, which reaches BibLaTeX's `\autocite*`.

Every retained Citation Item joins one command's key list. A LaTeX citation command carries exactly two optional arguments — a prenote and a postnote — so the first retained item's Citation Prefix becomes the prenote, and its Locator followed by its Citation Suffix becomes the postnote. A Citation Prefix, Citation Suffix, or Locator on any later retained item has no slot and raises a descriptive error naming that item, rather than being dropped.

The prenote form is natbib's and BibLaTeX's two-argument `\cite`, not the LaTeX kernel's single-argument one. A citation carrying no prefix emits at most one optional argument and compiles anywhere. The reference pages say so where they show the form.

A Locator and a Citation Suffix join one postnote with their source bytes between them, and the finished note is trimmed at its ends alone. Pandoc source needs the space in a `" and following"` suffix to separate the text from `@key`; a LaTeX optional argument is delimited by its own brackets and the bibliography package supplies the separator, so the leading space carries no meaning in this source form.

Suppress Author raises. LaTeX has no form for it that holds across bibliography packages, and emitting a citation that names the author when the source asked otherwise would change what the citation says.

An affix reaches LaTeX as source, so a Citation Prefix of `\emph{see}` renders as emphasis. Only what would change the command's own structure is acted on: a `]` is encoded as `{]}`, the idiom that keeps it from ending the optional argument, in the same spirit as the Pandoc serializer's braced citation keys; unbalanced braces and an unescaped `%` raise instead, since neither has a lossless encoding and a `%` would silently comment out the command's closing brace. An escaped `\]`, `\{`, `\}`, and `\%` are read as the literals they are.

A citation key that LaTeX cannot carry raises. Keys keep `_`, `:`, `-`, and `.`, which Better BibTeX's own key styles produce and which LaTeX never typesets, since it writes a key to the `.aux` file rather than setting it.

The Citation Item shape and its two boundary checks live in one module both serializers call, so a template's untyped `zt.citations` is narrowed one way and each serializer raises in its own error type. The Liquid provenance instrumentation recognizes both citation source filters, so invalid caller data reaches the Workbench as a citation-data mismatch under either one.

## Considered options

- **One command per Citation Item that carries a note**: preserves every note on every item, but emits adjacent commands whose typeset result no bibliography package defines, and turns one citation into several.
- **Escape every TeX special in an affix**: removes the `%` failure, but also breaks the `\emph{see}` affixes this source form exists to carry.
- **Reject a `]` in an affix**: matches the Pandoc serializer's affix round-trip, but fails an import over a bracket that `{]}` carries losslessly.
