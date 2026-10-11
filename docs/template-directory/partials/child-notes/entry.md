---
title: Child notes
summary: The notes you wrote in Zotero for the item, as links under a "Zotero notes" heading.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading]
features: [child-notes]
problems:
  - The notes I wrote in Zotero do not come into Obsidian.
  - I want my Zotero notes in my literature note.
  - My summary note in Zotero is missing from Obsidian.
keywords:
  - child notes
  - Zotero notes
  - item notes
  - notes
  - markdownNotes
  - Better Notes
  - import notes
audience: Readers who write notes in Zotero, such as a summary or questions, and want them beside the literature note.
effort: Add the partial to your template folder and call it from your profile's note body.
---

Each link shows the note's title, which is its first line in Zotero. The links follow the order in which you added the notes.

ZotLit imports each Zotero note into your vault once, as a note of its own. When you change a note in Zotero, the next update shows its new title in the link, but the imported note keeps its old text. To bring in your changes, open the imported note and run **Update imported note from Zotero**.

To show the text of each note inside the literature note instead of a link, change `{{ note.noteLink }}` to `{{ note.noteLink | embed }}` in the partial.
