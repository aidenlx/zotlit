# The Annotation View is the Annotations Layout of the Query View

One Query View draws a Query File in its tab, a Query File embed, a Query Block and the sidebar Annotation View. The Annotation Cards, card editing, Card Selection and the Annotation Repository stay as they are and become the Annotations Layout, next to Table, List and Cards. The sidebar Annotation View is a Query View whose Query Context is the Item and the Attachment its Follow Mode gives; its filter is `attachment == this.attachment`, so it shows the Annotations of one Attachment as before. It shows only the controls that have a meaning for one Attachment — colour, tag, search, and, in its More options menu, sort, grouping by colour or tag, and "Filter..." for the full filter — and "Save as query file" turns its current state into a Query File.

Proposed on 2026-10-14 with [#1459](https://github.com/aidenlx/zotlit/issues/1459).

## Considered Options

- **A new query view next to the current Annotation View** (rejected): two card lists and two filter models for the same Annotations.
- **The full query toolbar in the sidebar** (rejected): view switching, properties, limits and grouping by Item have no meaning for one Item.

## Consequences

- `this` carries an Item and, when there is one, an Attachment, read as `this.item` and `this.attachment`. It is the note that embeds the file or holds the block, and the Item and Attachment the sidebar follows. In a Query File's own tab `this` has no value, and a filter that uses it shows a diagnostic.
- The sidebar keeps the per-Attachment scope of the Annotation View, so the daily workflow does not change; "Save as query file" can save the Attachment or the whole Item.
- The query reads the Zotero database and can lag behind a Local API write. The Annotations Layout shows live records from the Annotation Repository in the order and groups the query gives, so a card edit shows at once.
- [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md) still holds in every host: reading never waits for the Editing Capability.
