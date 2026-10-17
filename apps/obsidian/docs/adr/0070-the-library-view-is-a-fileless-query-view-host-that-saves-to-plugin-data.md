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
