---
status: accepted
---

# Graph Citations extend Obsidian's graph through a per-render metadata facade

Graph Citations add citation edges and Cited Work Nodes to Obsidian's own global and local graph views instead of shipping a separate ZotLit graph view. For each live graph leaf, ZotLit wraps the engine's render call and, for that one synchronous call, gives the engine a metadata-cache facade whose resolved and unresolved link maps carry the citation edges from the Citation Index. The engine's own narrowing, orphan sweep, "Existing files only" row, search, groups, hover highlight, and active-note following then apply to citation edges unchanged. A second wrapper on the renderer's data hand-off stamps ZotLit colours on nodes that carry no user group colour, and the four renderer node callbacks are wrapped so a click on a Cited Work Node runs ZotLit's citekey action rather than creating an empty note.

The facade lives only inside one render call on one engine instance. Nothing else in the application observes it, which is what separates this from patching the app-wide metadata cache.

## Considered options

- A separate ZotLit graph view with a captured renderer class keeps every native control (search, groups, depth, following) to be rebuilt, and asks researchers to learn a second graph.
- Wrapping only the renderer's data hand-off runs after local narrowing, so depth and direction in the local graph never traverse a citation edge and the orphan sweep ignores them.
- Patching the app-wide metadata cache reaches every consumer of links (backlinks, search, publish) and cannot be scoped to one view.

## Consequences

- Every touched surface is undocumented Obsidian runtime behaviour verified against 1.13.4; the wrapper must guard each access, degrade to a message when the Graph core plugin is unavailable, and be re-verified when the minimum app version moves.
- The render wrapper depends on the engine reading its app reference once at the top of render; the edge tint proxy depends on the link sprite lifecycle. These two are the re-verification points.
- The Citation Graph commands apply a preset to a native graph leaf. Global graph options are one saved set, so a later panel change in a preset leaf saves the preset as the user's graph settings; the native "Restore default settings" button is the documented escape, chosen over snapshot-and-restore, which races with other graph leaves and with Obsidian's own save.
