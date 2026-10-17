# The Library View is the first screen

On a first install, ZotLit opens the Library View, not the Welcome View. It opens once, through the release flow that opened the Welcome View, and the researcher sees their papers before any setup. Browsing, search and opening a PDF need only the Zotero database, so the Library View asks for nothing more. When ZotLit cannot find the Zotero data directory, the tree and the list say so and offer "Locate data folder" and "Open settings", and the papers appear as soon as the folder is set. The Welcome View keeps its steps and logic but renders as a dismissable banner above the Library View while setup is incomplete; its "Create your first literature note" step becomes "Open your library". ZotLit Companion, Better BibTeX and the local server are named only at the action that needs them.

Proposed on 2026-10-17 with [#1554](https://github.com/aidenlx/zotlit/issues/1554).

## Considered Options

- **Keep the Welcome View as the first screen** (rejected): it opens on setup steps, and the researcher sees requirements before they see their library.
- **Remove the Welcome View** (rejected): the upgraded state's Migration Prompt and the connection readout still have to reach v1 upgraders.
- **The Library View first, with the Welcome View as a banner** (chosen): the first thing on screen is the library, and setup appears beside it, not in front of it.

## Consequences

- An upgrade from v1 still shows the Migration Prompt, now in the banner, until it is acknowledged.
- The ribbon icon and the command that opens the Library View (#1545) reach it at any time.
- The getting-started docs start from the Library View (#1555).
- Dismissing the banner saves `welcome.dismissed` in plugin data and acknowledges a pending Migration Prompt; the "Open welcome view" command shows the banner again. Setup counts as complete when ZotLit reads the Zotero database and the literature-notes folder exists; "Open your library" counts as done once the database reads.
- When the data folder is missing, the not-found state replaces the tree, the facets, the search box and the list; the search asks the database nothing until the folder is found. The "Zotero wasn't found" notice and "Set up connection" open the Library View.
- The Welcome View has no tab. The `zotlit-welcome` view type stays registered only to turn a tab restored from an old workspace into the Library View, or to close it when a Library View is already open; it can go in a later release.
- The Companion step is gone from the banner; the release notice for Companion still reaches users who update.
