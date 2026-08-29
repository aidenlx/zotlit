# Pandoc citation formatting uses one complete serializer

The `pandoc_cite` Liquid filter accepts the `zt.citations` array and produces Pandoc citation source. A matching Eta helper and the Liquid filter call one pure serializer in `@zotlit/templates`. The serializer covers every Citation Item property, including Citation Prefix, Citation Suffix, Locator Label, Locator, Suppress Author, and Pandoc-safe citation key encoding, so template output and ZotLit's other Pandoc source generation share one meaning.

The serializer owns the complete source form, including brackets. Its default mode produces a Citation Cluster. Its `prefer-author-in-text` mode produces an Author-in-text Citation when that form can preserve every Citation Item property, and falls back to a Citation Cluster when it cannot.

`prefer-author-in-text` inspects the first Citation Item with a citation key. A Citation Prefix or Suppress Author selects the Citation Cluster fallback. A Locator, Citation Suffix, and later Citation Items stay in the Author-in-text Citation's trailing brackets. An input with no keyed items produces an empty string.

Every Locator uses Pandoc's explicit braced form, such as `, {p. 3}`, so citeproc receives it as a Locator for every value. Citation keys use Pandoc's exact simple-or-braced token rules. A non-null key that Pandoc cannot represent raises a descriptive error.

The serializer validates its output by parsing it and comparing the Citation Item count, citation keys, modes, and Suppress Author values. A mismatch raises a descriptive error. ZotLit's source parser recognizes the Author-in-text Citation form emitted by the serializer, including its trailing Locator, Citation Suffix, and later Citation Items.

Citation Prefix and Citation Suffix retain their source whitespace and punctuation. A Citation Item with a null citation key is omitted, a non-null sentinel is serialized, and an input with no serializable items returns an empty string. Invalid input shapes raise a descriptive type error.

Liquid exposes `pandoc_cite`; Eta exposes `pandocCite(zt.citations)`. Embedded defaults use these engine forms. User-owned copies of earlier templates keep their existing loops and remain supported.

Citation formatting is a template-engine capability. The generated Template Contract keeps its note, annotation, and filename roots, while the vault-global `cite` and `cite2` templates continue to receive their existing hand-built data shape. This boundary gives both template engines byte-identical output without expanding the contract work deferred for a future citation root.

The Pandoc Citation Source Module lives under `@zotlit/templates` and exposes one formatter and one scanner. The formatter returns complete source text; the scanner returns the Citations and Citation Items found in source. Key encoding, source-form selection, parsing, and round-trip validation stay inside the Module.

All existing callers move directly to this Interface in the same change. The previous parsing and formatting exports in `citation-grammar.ts` and `citation-fragment.ts` are removed after their callers move. App-specific queries use the shared scanner directly, and Liquid and Eta keep only their required engine Adapters.

## Considered options

- **Reproduce the existing default loops**: preserves their output, but keeps Citation Prefix and Citation Suffix data-only and creates a weaker serializer beside ZotLit's complete Pandoc source builder.
- **Add citation formatting to the Template Contract**: gives the operation one `zt` surface, but couples this focused template-ergonomics change to the larger citation-root design.
