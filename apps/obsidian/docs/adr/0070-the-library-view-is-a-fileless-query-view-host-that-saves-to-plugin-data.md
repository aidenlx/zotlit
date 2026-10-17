# The Library View is a fileless Query View host that saves to plugin data

The Library View is a fourth host of the one Query View (ADR 0069), with no Query File and no Query Context. What it shows is its Library View Document: the Library Tree node, the Reading State facets, the search text, the sort, the Layout and the Visible Properties. The document is saved per vault under one SettingsService key, `library.document`, in `data.json`. The Query View's text derives from the document; a toolbar change comes back as new text, from which the host takes the sort, the Layout and the Visible Properties into the document. The save target is one explicit part of the host contract: `pluginDataStorage` gives a host a `save` that writes its key and then awaits the write, so a failed write rejects and the toolbar says "not saved", as for a Query File.

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **A Query File in the vault** (rejected): the researcher did not make it, would see it in the file explorer, and could delete or rename it from under the view.
- **Workspace state of the leaf, as the sidebar Annotation View keeps its query** (rejected for the Library View): it is per leaf and goes when the leaf closes, but the Library View comes back as the researcher left it in every tab that opens it.
- **`app.saveLocalStorage`** (rejected): per device, and does not sync with the vault.
- **Plugin data through the SettingsService** (chosen): per vault, synced with the vault's plugin folder, validated by one schema, and its `flush()` reports a failed write.
- **Move the sidebar Annotation View to plugin data too** (rejected for now): its query is per leaf by design (ADR 0041 keeps its Follow Mode in workspace state the same way). It can take `pluginDataStorage` with its own key later without a change to the contract.

## Consequences

- The document, not the Query View text, is what plugin data holds. A toolbar change that the document has no field for, such as a filter edit or a column width, does not stay; the Library View offers the controls whose state the document keeps.
- The stored document has a strict schema; a stored value this build cannot read takes the default document, and a field of it that does not parse takes its default.
- The Library View still runs every query through the database Read Mode (ADR 0047); saving the document never writes to Zotero.
- The host contract has two hooks for the Library View (#1545). `libraries` puts the selected Library on the request and in its run key, so a change of Library runs the query again; the host calls `contextChanged()` after it, since the text alone does not change. `displayOnly` removes every toolbar control whose change the document cannot keep: Add view and Configure view, Group, Filter, the row limit, column resize and the property pages. Every control reads one capability set, `QueryView.can` (`views`, `group`, `filter`, `limit`, `columnWidth`, `propertyPages`), that the host options decide; a new control that the document cannot keep adds a flag there, not a check of its own (#1547). The view menu comes back with only the Layout switch the host offers (ADR 0074).
- Every Library View query has a row limit of 1,000. On a 50,000-Item Stress Build, an unlimited My Library kept the window from responding for more than 30 s; with the limit it showed in 0.2–0.4 s, and the toolbar says "1000 of 50000 results". The limit applies after the sort, so a search with more matches than the limit loses the lowest-ranked ones (ADR 0072).
- "Save as query file" writes the Query View text of the document, minus the search key set, with the Library as a filter (ADR 0071) and the row limit kept, so the saved file shows what was on screen. The vault-side facets have no Query File form yet (#1531).
- A host can narrow the rows after the query with `rowPass` (`{key, keeps(row)}`), for the conditions the vault answers (ADR 0071). While a pass is active the request runs without a limit, and the view's limit then cuts the kept rows, so "N of M results" counts kept rows; the pass key is part of the run key. The facets are document state, not a toolbar control, so `can` has no flag for them. On a large Library this reads every match of the node; an engine condition (#1531) removes that cost.
- The Reading Card (#1552) is a second Query View inside the Library View, with no toolbar: one Annotations view filtered by `item == this.item`, whose Query Context is the selected Item, in that Item's Library. The list itself still binds no Query Context. The card shows every Annotation type, as the reading-state line counts them, and takes its buttons from the row menu's operations (ADR 0073).
