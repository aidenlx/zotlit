# Zotero Companion

The Zotero-side add-on. It observes what the user does in Zotero, pushes events to the Obsidian plugin, and keeps Zotero's database readable by that plugin.

## Language

**Application Blur**:
The moment the whole Zotero application loses operating-system focus — the user switched to another application. A signal that the user has stopped working in Zotero, and may now be looking at Obsidian. Distinct from Window Deactivate: Zotero is many windows, and focus moving between two of them is not Application Blur.
_Avoid_: blur (ambiguous — a single window blurs too), focus loss, background

**Window Deactivate**:
A single Zotero window loses focus while Zotero itself stays frontmost — the user moved from the library window to a reader window, or opened preferences. Carries no meaning about whether the user left Zotero.
_Avoid_: window blur (invites confusion with Application Blur)

**Checkpoint**:
Moving committed changes out of the write-ahead log sidecar and into the main database file, so that a reader of the main file alone sees them. The operation the Companion performs on Zotero's behalf; it changes no data.
_Avoid_: flush (already names reader-state flushing in the notify layer), sync (that is Zotero's own remote sync), commit

**Staleness Window**:
The interval between a change committing in Zotero and that change becoming visible to the Obsidian plugin. Checkpoints shrink this interval; they do not close it to zero.
_Avoid_: lag, delay (both read as performance, not correctness)

**Database Status**:
The Companion's user-facing report of whether the main database file holds the user's recent work, together with the on-demand control that writes it there.
_Avoid_: note status (that names the Literature Note column), sync status (that is Zotero's own remote sync), database health
