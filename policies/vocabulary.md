# Vocabulary

- Use **ZotLit Companion** as the proper name. On first mention, write **ZotLit Companion, the Zotero add-on**. Later, write **the Companion**. Avoid **Zotero companion**, **ZotLit Zotero companion**, and **companion plugin**.
- **Indexed Key** is the internal term for a Zotero object's canonical cross-library identity.
- Use **Zotero key** in English public copy and **Zotero 标识符** in Chinese public copy for an Indexed Key.
- Use **citation key** in English public copy for an item's human-readable identifier from Zotero's `citationKey` field; use **文献引用标识（citation key）** in Chinese public copy.
- Reserve `citekey` for the compatibility frontmatter key; preserve it in code and schemas where the field name is part of a contract.
- **Venue** is the internal term for the journal, book, website, repository, university, or publisher an Item appeared under. Keep it in code, tests, glossaries, specs, and ADRs.
- In public copy — docs, changelog, UI strings, release notes — name the concrete thing (the journal, the repository, the publisher), or write **publication** where one word is needed. **Venue** is too obscure for readers.
