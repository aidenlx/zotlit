# Venue resolves the container role before the publisher role

A result row in the literature-note quick switcher needs one word for "where this appeared" that holds for every Zotero Item type. Zotero has no such field: a Journal Article records `publicationTitle`, a Book Section `bookTitle`, a Preprint `repository`, a Thesis `university`, a Book `publisher`. The renderer previously compared the Item type against `journalArticle` and read that type's field shape, so every other type rendered as a bare title.

**Venue** is that one word, defined in the `@zotlit/db` glossary and resolved in the data model rather than in the renderer. It is an ordered chain over the Item's base-field view: the **container role** (Zotero's `publicationTitle` base field) first, then the **publisher role** (the `publisher` base field). The first populated field wins.

Container wins over publisher unconditionally. This is the common case, not an edge case: Journal Article, Book Section, Webpage, Conference Paper, Dictionary Entry, Encyclopedia Article, Magazine Article, and Newspaper Article all record a publisher field beside their container. The rule names the work rather than the company that issued it, which is why a Radio or TV Broadcast shows its program title rather than its network.

Resolution reads the base-field mapping rows of the connected database, not a table generated from Zotero's upstream schema. That is what makes custom Item types and custom fields resolve like stock ones.

## Consequences

- Eight non-child Item types record neither role — Artwork, Bill, Case, Email, Instant Message, Letter, Patent, Statute — and have no Venue. Their rows carry the Author Summary and year alone; nothing is invented for them.
- The chain is written as an ordered list rather than a two-branch conditional, so a third step can be appended without touching callers. Several of those eight have a natural identity field (Case already has `court` indexed by the search index), so a further step is plausible.
- Deriving Venue from the Zotero-to-CSL mapping was rejected. That mapping carries citation-rendering-specific behavior a suggester subtitle should not inherit.
- Venue is display-only. The search index is unchanged: it canonicalizes the container role and indexes nothing from the publisher role, so typing a repository name does not find Preprints. Making Venue searchable would move ranking for every existing query and belongs to its own decision.
- `Item.fields` stays raw, per-type. The base-field view sits beside it as `Item.baseFields`, so the template data contract is untouched and no user's templates change output.
