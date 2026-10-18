# The Library Tree writes filters

Selecting a node in the Library Tree changes the query of the Library View; the tree never hands rows to the view. A Library becomes the Target Libraries of the request (`libraries` of the Query View request), not a `library ==` filter. A Collection becomes that Library plus the condition `collections.within("<root-first path>")` in the filters for all views, so its subcollections' Items show too. The Reading State facets join the same filters: Annotated `annotations.length > 0`, PDF `attachments.filter(value.fileType == "pdf" && value.exists).length > 0`, Unread `annotations.isEmpty()`. A facet the vault answers, Has note, and the Literature Note half of Unread, is a condition the view applies to the rows after the query (#1531 decides whether the engine takes it over).

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **Rows from the tree** (rejected): a second way to list Items next to the query, with its own sort, refresh and expansion.
- **The Library as a `library == "group:N"` filter** (rejected): a filter can only narrow inside the Library Scope in force, so "All libraries" could not widen it, and the engine does not lower it to a candidate set, so every Library in scope is scanned.
- **The Library on the request** (chosen): the Query View reads it from its host with the rest of the request, and a change of Library runs the query again.
- **A Collection by key** (rejected for now): the Filter Expression language names a Collection by its path. The document keeps the path as a list of names, joined with `/` only in the condition.

## Consequences

- "Show all libraries" widens the tree past the Library Scope for the session, except Recent (ADR 0076); it is not part of the Library View Document. A selected Library outside the Library Scope stays in the tree. The toggle shows only when the database holds Libraries outside the Library Scope.
- The Query View gains a host hook for the Target Libraries, part of its run key (#1545).
- A Collection name that holds `/` cannot be told from a deeper path in `collections.within`, as everywhere in ZotLit Query.
- A renamed or deleted Collection no longer matches the saved path. When the Collections of its Library were read without error and the path is not among them, the tree selects that Library in its place and saves it; a failed read changes nothing (#1546).
- The paper count of a node is the number of Items its selection lists with no facet and no search: a Collection counts the distinct Items of its subtree, as `collections.within` selects them, so the count in the tree and in the list header agree (#1546). The counts come from one grouped Items query per Library the tree shows, grouped by `collections[]`: a group value names a Collection by its path only, and the same path can exist in two Libraries. On a 50,000-Item Stress Build the first count after a database change took about 1.7 s in the worker, with no frame gap over 9 ms in the window, and a repeated count 0.15–0.2 s.
- Unread gains `lastRead == null` once ZotLit Query reads `lastRead` (#1532, #1533).
- "Save as query file" (#1553) writes the Library as `library == "<selector>"`, first in the filters for all views, since a Query File tab reads the whole Library Scope and has no host to put the Library on its request. A file saved from a Library outside the Library Scope therefore lists nothing until that Library joins the scope.
- The vault conditions run before the row limit (ADR 0071), so Has note and Unread never hide a match that a smaller page would have shown.
- The list header reads "Selection · M unread"; the paper count shows once, beside the node in the tree, and the header leaves it out (amended after the interface review). Like the paper count, the unread count ignores the facets and the search: it is the Items of the node with no Annotation and no Literature Note, counted again on a database, scope, node or Note Index change. Recent has no header text, since the selected node names it. The count the facets narrow is the toolbar's "N of M results", and the search summary while a search is on screen, which screen readers hear as a status.
- The facets stay on during a search and during "Search all libraries", which drops the Collection condition but not the facets (ADR 0073). Facets combine with Recent as with any node.
