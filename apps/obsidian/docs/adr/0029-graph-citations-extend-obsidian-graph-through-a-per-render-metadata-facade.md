---
status: accepted
---

# Graph Citations extend Obsidian's graph through a per-render metadata facade

Graph Citations add citation edges and Cited Work Nodes to Obsidian's own global and local graph views instead of shipping a separate ZotLit graph view. For each live graph leaf, ZotLit wraps the engine's render call and, for that one synchronous call, gives the engine a metadata-cache facade whose resolved and unresolved link maps carry the citation edges from the Citation Index. The engine's own narrowing, orphan sweep, "Existing files only" row, search, groups, hover highlight, and active-note following then apply to citation edges unchanged. A second wrapper on the renderer's data hand-off colors Cited Work Nodes that carry no user group color. Cited Work Node callbacks provide citation-specific actions, including creating a Literature Note. Existing file nodes keep native colors and interactions unless the user selects a graph control or color group.

The facade lives only inside one render call on one engine instance. Nothing else in the application observes it, which is what separates this from patching the app-wide metadata cache.

## Considered options

- A separate ZotLit graph view with a captured renderer class keeps every native control (search, groups, depth, following) to be rebuilt, and asks researchers to learn a second graph.
- Wrapping only the renderer's data hand-off runs after local narrowing, so depth and direction in the local graph never traverse a citation edge and the orphan sweep ignores them.
- Patching the app-wide metadata cache reaches every consumer of links (backlinks, search, publish) and cannot be scoped to one view.

## Consequences

- Every touched surface is undocumented Obsidian runtime behaviour verified against 1.13.4; the wrapper must guard each access, degrade to a message when the Graph core plugin is unavailable, and be re-verified when the minimum app version moves.
- The render wrapper depends on the engine reading its app reference once at the top of render; the edge tint proxy depends on the link sprite lifecycle. These two are the re-verification points.
- Each graph view owns its selected options. Citation Graph commands apply their preset to the target view; separately opened ordinary graphs start from ordinary defaults. View restoration preserves each graph’s options; native bookmarks capture and restore global graph options. This requires isolation from Obsidian's shared global graph options.

## Native defaults and explicit presentation choices

"Show citations in graph view" remains enabled by default. It adds citation connections to Literature Notes and Cited Work Nodes to both global and local graphs. "Existing files only" hides Cited Work Nodes. Turning the feature off removes the added connections, nodes, and controls; native groups and other explicit native settings remain user-owned.

Ordinary graphs use native styles for existing notes and links. Added connections participate in native layout, local depth, orphan filtering, and neighbor highlighting, so the resulting node positions and membership can change. Cited Work Nodes retain their citation-specific actions and muted default color.

"Color citation links" and "Citation popover" are independent per-view controls, both off by default. The link-color control applies to citation connections, including existing wikilinks classified as citations. With the popover control off, existing file nodes use native hover. Enabling it opts that view into citation popovers. ZotLit's graph controls remain available while Graph Citations is enabled.

Both choices persist with the global or local graph view. Reopening a saved view restores its choices. Native global graph bookmarks capture and restore both choices. A separately opened ordinary graph starts with both controls off, even after a Citation Graph shortcut was used elsewhere.

## Literature Notes Group and shortcut

Literature Note colors belong to ordinary graph color groups. The Citation Graph shortcuts enable link coloring and citation popovers and add the Literature Notes Group. They retain the citation-focused preset: citation-connected nodes, admitted citation sources enabled, arrows on, tags and attachments hidden, orphans hidden, and Cited Work Nodes visible.

The public `--zt-graph-literature-note-color` theme variable sets the initial color of a new Literature Notes Group. Its low-specificity defaults use ZotLit orange from the brand palette referenced by `apps/docs/DESIGN.md`: `#E8622C` in light mode and `#F0793F` in dark mode. The group takes the current theme's starting color at creation, then keeps its saved color across theme changes. Native controls own its color, order, and removal.

An existing matching group keeps its color and position. A new group is appended after existing groups. Removing it returns color control to the remaining native groups and native node styles. Running the shortcut again adds the group if it is absent. The separate "Add literature notes group" action uses the same rules.

These choices make group removal effective and keep citation presentation under explicit user control. They replace the earlier automatic Literature Note coloring and shared global preset persistence decisions.

## Verification required for implementation

Verify independent global and local views, view restoration, and native global graph bookmark restoration into both new and existing global views. Include bookmarks with opposite toggle values, restoration after restart, native hover with popovers off, and group removal followed by shortcut reuse.
