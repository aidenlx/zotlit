# Recent is a Library Tree node that writes a sort

Recent, at the top of the Library Tree, writes a sort, not a filter: it selects every Item of the Libraries in the Library Scope, sorted by last activity, newest first, and gives each row a reason, such as "read 2 h ago in Obsidian". Last activity is defined once, by #1532: the newest of the Item's `lastRead` across its Attachments, its `dateModified`, its newest child note and the Obsidian usage ledger. Until that lands, Recent sorts by `dateModified` and gives no reason: every row would read "edited in Zotero", which the sort already says (amended after the interface review); the sort expression and the source of the reason are the only parts that change. Recent is the selection of a new Library View.

Proposed on 2026-10-17 with [#1550](https://github.com/aidenlx/zotlit/issues/1550).

## Considered Options

- **Recent as a "modified in the last two weeks" filter** (rejected): Zotero's Recently Read has a two-week cutoff, but a researcher who comes back after a month would see an empty list.
- **A separate recent list outside the Query View** (rejected): it would lose the Layouts, the facets and the expansion.
- **A sort over the whole Library Scope, with a row limit** (chosen): the list is never empty while the library has Items, and the facets still narrow it.

## Consequences

- The Library View Document gains a `recent` node kind; its derivation sets the sort and adds no filter; the row limit is the Library View's (ADR 0070).
- While Recent is selected, the sort control shows the last-activity sort, and changing it selects nothing else in the tree.
- Recent shows no paper count.
- The quick switcher's empty query and Recent share one last-activity sort once #1532 lands.
- The reason is text the host gives each row through `QueryViewHost.reason(row)`, not a filter, a sort, a Formula or a Visible Property: the #1532 ledger reason has no Formula form. The Papers reading-state line ends with it; the Table shows none.
- Recent reads the Libraries of the Library Scope that the database holds; "Show all libraries" does not widen it.
- Selecting Recent writes its sort (`RECENT_SORT`, `dateModified DESC` until #1532). A later sort change is saved and Recent stays selected; selecting Recent again writes its sort again.
- "Save as query file" on Recent writes no `library ==` filter, so the file reads the Library Scope as Recent does.
- The Sort button marks a sort as set only when it differs from the sort the selected node writes, so Recent's own sort leaves the button plain; the result count follows the same rule for the Library View's row limit (amended after the interface review).
