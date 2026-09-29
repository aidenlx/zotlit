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

A **Zotero notes** heading, then one link for each note you wrote in Zotero for the item, in the order you added them. Each link shows the note's title, which is its first line in Zotero.

ZotLit imports each of these notes into your vault once, as a note of its own, and the literature note links to it. When you change a note in Zotero, the link shows the new title on the next update, but the imported note keeps its old text. To bring in your changes, open the imported note and run **Update imported note from Zotero**. When the item has no notes in Zotero, the partial writes nothing, not even the heading.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block:

```liquid
{% render "child-notes" with zt as zt %}
```

To show the text of each note inside the literature note instead of a link, change `{{ note.noteLink }}` to `{{ note.noteLink | embed }}` in the partial.
