# Search enters the Library View as an ordered key set

The search box of the Library View asks the worker search (`SearchItems`, through `ItemLookup`) for the Libraries of the selected node, ranked as the quick switcher ranks. The document keeps the search text; the Indexed Keys the search found, best match first, are an input of the derivation. They become the condition `["K1", "K2", ...].contains(indexedKey)` in the filters for all views, which ZotLit Query lowers to an Indexed Key selection, and the view shows the rows in the rank order of the keys in place of the sort. An empty key set selects no Item.

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **A `search(...)` Filter Expression function** (deferred): it would make a search expressible in a Query File, but it needs ranking in the engine.
- **A text filter on titles and creators** (rejected): it does not rank as the quick switcher does, and two search behaviours would differ.
- **Rows from the search, outside the query** (rejected): they would lose the Layout, the expansion and the Reading State line.
- **A key set, re-ranked by the view** (chosen): one search behaviour for the quick switcher and the Library View, and the rows still come from the one query, so the tree node and the facets still narrow them.

## Consequences

- ZotLit Query has no order "by a given key list"; the host puts the rows in rank order after the query.
- The search has the result limit of `SearchItems`; an Item past it does not show, even when it matches the tree node.
- The `tag:` token is a `tags.contains` condition next to the key set (#1548).
