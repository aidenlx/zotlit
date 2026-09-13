---
status: accepted
---

# Work Labels replace the graph node's text sprite

A node in Obsidian's graph is labelled by `GraphNode.getDisplayText()`, which returns the last segment of the node's id with a `.md` extension removed. For a Literature Note that is the file name, chosen for file identity rather than for reading at a glance, and for a Cited Work Node it is the Citation Key. Neither tells a researcher what the work is, so the graph is read by hovering rather than by looking.

ZotLit draws a **Work Label** instead: an Author Summary with the year on the first line, and the work's short title on a dimmed second line. A Literature Note and a Cited Work Node for the same work carry the same label, so node colour alone carries whether a note exists. The label is a per-view Display choice, off by default, turned on by the Citation Graph commands with the rest of their preset.

One `PIXI.Text` holds one style, so a label with two typographic levels needs two sprites. ZotLit therefore replaces the node's `text` member with a container it owns, holding one sprite per line.

`initGraphics` builds a node's graphics lazily — the render loop serves the fifty nodes nearest the viewport centre each frame — so most nodes hold no text sprite when `setData` returns, and a single pass after `setData` reaches almost none of them. ZotLit wraps `initGraphics` on each node instance instead, from the `setData` wrapper the service already owns for node colours. Native `initGraphics` runs first and builds its own sprite; the wrapper then replaces it. Nodes are constructed only inside `setData`, so every node passes through this path, and scoping to one renderer follows from where the wrapper is installed rather than from a guard.

The container owns its own `updateTransform`, which PIXI calls each frame on visible objects. That is where the second line's zoom behaviour lives: its alpha ramps over the octave after the first line reaches full opacity, expressed against the renderer's own text-fade term, so a user who has moved Obsidian's **Text fade threshold** slider moves both lines together. The highlighted node shows its second line at full strength at any zoom, which keeps the title reachable while zoomed out.

Label text is resident before render, not read during it. The render path is synchronous inside `requestAnimationFrame`, the Note Index holds paths and Zotero keys with no metadata, and reading an Item costs one prepared statement per Item. A cache inside the Graph Citations service holds the drawn works only — the Literature Note paths and Cited Work Nodes the adapter already computes — and fills during the existing render debounce.

## Considered options

- **One sprite carrying both lines through `getDisplayText()`.** A newline inside the returned string is free and reaches the stable prototype seam. It gives two lines of one style, where both lines compete for the eye and neither reads as the subject of the other. The hierarchy is the reason to draw a second line at all.
- **Patching `GraphNode.prototype.initGraphics`.** One patch for every graph, reached through a live node's constructor. It mutates a prototype ZotLit does not own, reaches other plugins' graphs, and needs a renderer guard on every call.
- **Repairing nodes from the renderer's frame callback.** Simple to reason about and pays for every node on every frame, forever.
- **Improving the file name instead.** A file name serves file identity and link text. Tuning it for the graph asks a researcher to satisfy two readers with one string.
- **Carrying display fields on the Citekey Resolution Snapshot.** The cheapest read shape, and it loads title and creators for every citekeyed Item in the library when the graph draws a far smaller set, and puts view presentation inside the Citation Index against the line ADR 0024 draws.

## Consequences

- A node's label and Obsidian's graph search no longer agree. The search box matches the file; the label is canvas text. ZotLit writes no creator name into a Literature Note, so a name read off a node finds nothing when typed into the search box. The how-to page states this.
- Work Labels stay off in a graph saved or bookmarked before they shipped. Each view owns its options, so a saved view keeps the options it saved. Running a Citation Graph command again applies them.
- A work ZotLit cannot read keeps Obsidian's own file name. A missing or ambiguous Citation Key keeps its Citation Key, which is the string the reader has to correct.
- Two more internal members join ADR 0029's re-verification list for each minimum-version bump: the node text sprite lifecycle, where `initGraphics` builds the sprite, `clearGraphics` destroys it, and `setData` reuses it; and the renderer's text-fade term, read with a guard and treated as zero when absent.
