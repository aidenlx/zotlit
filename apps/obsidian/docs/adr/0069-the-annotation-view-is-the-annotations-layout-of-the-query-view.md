# The Annotation View is the Annotations Layout of the Query View

One Query View draws a Query File in its tab, a Query File embed, a Query Block and the sidebar Annotation View. The Annotation Cards, card editing, Card Selection and the Annotation Repository stay as they are and become the Annotations Layout, next to Table, List and Cards. The sidebar Annotation View is a Query View whose Query Context is the Item its Follow Mode gives. It shows only the controls that have a meaning for one Item — colour, tag, search, sort, and grouping by colour or tag — and "Save as query file" turns its current state into a Query File.

Proposed on 2026-10-14 with [#1459](https://github.com/aidenlx/zotlit/issues/1459).

## Considered Options

- **A new query view next to the current Annotation View** (rejected): two card lists and two filter models for the same Annotations.
- **The full query toolbar in the sidebar** (rejected): view switching, properties, limits and grouping by Item have no meaning for one Item.

## Consequences

- `this` means the same thing in every host: the Query File in its tab, the note that embeds the file or holds the block, and the Item the sidebar follows.
- The query reads the Zotero database and can lag behind a Local API write. The Annotations Layout shows live records from the Annotation Repository in the order and groups the query gives, so a card edit shows at once.
- [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md) still holds in every host: reading never waits for the Editing Capability.
