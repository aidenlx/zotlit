# The Tag Selector writes tag filters

The Library Tree ends with a Tag Selector, as Zotero's main window does: the tags of the Items the selected node lists, as a wrapping list of names under the Reading State facets, with a "Filter tags" box at its foot. Selecting a tag narrows the list to the Items with that tag; selecting more narrows to the Items with every selected tag, as in Zotero. Each selected tag becomes `tags.contains("<name>")` in the filters for all views, beside the node's conditions and the facets (ADR 0072). The selected tags are part of the Library View Document, as `tags`, and "Save as query file" writes them with the rest of the filters.

Proposed on 2026-10-18 after the second interface review.

## Considered Options

- **Tags as `tag:` tokens in the search box** (rejected as the only way): the search box already reads them (ADR 0073), but a researcher who knows Zotero looks for the tags under the tree, and a token has to be typed and spelled.
- **Any of the selected tags** (rejected): Zotero narrows by every selected tag, and a researcher who comes from it expects the list to shrink with each click.
- **A Tag Selector in the tree that writes filters** (chosen): one more document field, turned into conditions the engine already runs, so the tree still never holds rows (ADR 0072).

## Consequences

- The Tag Selector lists the tags of the Items the node lists with no facet and no search, as the paper count reads them (ADR 0072). While tags are selected, it lists only the tags of the Items that have every selected tag, so a click never leads to an empty list. A selected tag always shows, highlighted, even where the node holds no Item with it.
- The tags come from one grouped Items query by `tags[]` per node and selection, in the worker, as the paper counts do. The list shows tag names without counts, sorted by name, and the "Filter tags" box narrows the names it shows. It never changes the list of papers.
- The selected tags stay when the researcher selects another node, as in Zotero. "Deselect all" in the Tag Selector clears them. The list header names the selected tags while any are selected, so a filter is never invisible.
- A tag `tag:` token in the search box and a selected tag are two ways to write the same condition; neither rewrites the other.
- Zotero's coloured tags and its "Display automatic" switch are left out for now: the Library View reads tag names only.
