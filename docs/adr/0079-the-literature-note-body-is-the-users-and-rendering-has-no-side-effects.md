---
status: accepted
---

# The Literature Note body is the user's, and rendering has no side effects

Amends ADR 0001 (the 2026-07-02 default put a Child Note list in a Managed Region, and rendering a `noteLink` imported the Child Note).

The default Literature Note Template has no Managed Block. Its body renders once, when the note is created. After that the body is the user's: Update refreshes the Properties and leaves the body as written. The `## Annotations` Query Block stays in the default, outside any Managed Region, because it is a live view and does not need to be re-rendered. The `## Notes` list of Child Notes is removed from the default.

Rendering `noteLink` never imports a Child Note. When an Imported Note exists for the Child Note, the link goes to that file. When none exists, the link is `[<title>](zotero://select/…)`, built with `itemSelectUri`, the same URI the Query View table uses for note rows. A Child Note becomes a file only through an explicit command: import child notes, import all notes, or batch import.

The flow is a one-way ticket from Zotero to Obsidian. A Literature Note body and an Imported Note are copies that ZotLit takes when the user asks: at creation, or when an import command runs. There is no automatic sync and no two-way sync: an edit to the copy never goes back to Zotero, and a later edit in Zotero reaches the copy only through an explicit re-import or Overwrite. A Query Block reads Zotero live; it is a view, not a synced copy.

The shared reason: **the body is the user's, and rendering has no side effects.** The research on branch `research/note-refresh-user-needs` (`docs/research/note-refresh-user-needs.md`, sections "Copy versus live view, after D1 and D2", "Zotero child notes: does anyone need the implicit import?" and "What the needs imply for the managed region") found that:

- users who write in Obsidian do not want ZotLit to rewrite the part of the note that they own;
- the implicit import created files silently, froze them after the first render, and had no setting to turn it off;
- the users who want Child Notes in the vault want either a one-time move or a current view, and an explicit command or a live view serves both better than a side effect of rendering.

## Considered options

- **Keep the Managed Block and drop only `## Notes`.** Rejected. The only thing left in the region would be the Query Block, which is already live, so the region would only add markers that the user must not touch.
- **Keep the implicit import behind a setting.** Rejected. A render that writes other files makes Preview, Update and Overwrite hard to predict, and the explicit commands already cover the need.

## Consequences

- Existing notes are not migrated. A note that has `%%zt-managed%%` markers keeps them: when its Profile has no Literature Note Template document (the built-in default), Update re-renders the region from the `content` slot, now without importing. Removing the two marker lines stops management, and Update then leaves the body alone.
- A note with markers whose Profile uses the ejected or duplicated built-in document gets the "no Managed Block" notice on Update, because that document has no Managed Block. The template is now the user's, so the user adds a Managed Block if they want one.
- The commands do not change. For a default note, Update refreshes the Properties, plus any Managed Region that the user's own template has. Overwrite replaces the whole body after confirmation.
- Previews and the Template Workbench show the same `zotero://` link that a real render writes.
- Out of scope: a live view of Child Notes (#1686) and annotation comments kept in Obsidian (#1685).
