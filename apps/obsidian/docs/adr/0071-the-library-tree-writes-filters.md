# The Library Tree writes filters

Selecting a node in the Library Tree changes the query of the Library View; the tree never hands rows to the view. A Library becomes the Target Libraries of the request (`libraries` of the Query View request), not a `library ==` filter. A Collection becomes that Library plus the condition `collections.within("<root-first path>")` in the filters for all views, so its subcollections' Items show too. The Reading State facets join the same filters: Annotated `annotations.length > 0`, PDF `attachments.filter(value.fileType == "pdf" && value.exists).length > 0`, Unread `annotations.isEmpty()`. A facet the vault answers, Has note, and the Literature Note half of Unread, is a condition the view applies to the rows after the query (#1531 decides whether the engine takes it over).

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **Rows from the tree** (rejected): a second way to list Items next to the query, with its own sort, refresh and expansion.
- **The Library as a `library == "group:N"` filter** (rejected): a filter can only narrow inside the Library Scope in force, so "All libraries" could not widen it, and the engine does not lower it to a candidate set, so every Library in scope is scanned.
- **The Library on the request** (chosen): the Query View reads it from its host with the rest of the request, and a change of Library runs the query again.
- **A Collection by key** (rejected for now): the Filter Expression language names a Collection by its path. The document keeps the path as a list of names, joined with `/` only in the condition.

## Consequences

- The Query View gains a host hook for the Target Libraries, part of its run key (#1545).
- A Collection name that holds `/` cannot be told from a deeper path in `collections.within`, as everywhere in ZotLit Query.
- A renamed Collection no longer matches the saved path, so the saved node shows no Items; the Library Tree (#1546) decides what it selects in its place.
- The paper count of a node is the number of Items its selection lists with no facet and no search: a Collection counts the distinct Items of its subtree, as `collections.within` selects them, so the count in the tree and in the list header agree (#1546).
- Unread gains `lastRead == null` once ZotLit Query reads `lastRead` (#1532, #1533).
