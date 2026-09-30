---
title: Authors as links
summary: Every author as a link to a note of their own, so one person's papers gather in one place.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading, literature-review]
problems:
  - I want to see every paper by one author in one place.
  - I want my authors as links in the note.
  - I want a note for each author.
keywords:
  - authors
  - creators
  - author notes
  - people
  - wikilinks
  - backlinks
  - graph view
audience: Readers who keep a note for each author, or want the graph view to connect papers through the people who wrote them.
effort: Add the partial to your template folder and call it from your profile's note body.
---

A link to an author who has no note yet still works: Obsidian creates the note when you select the link. That note then lists, under **Backlinks**, every literature note that names the author.

The links use the name as Zotero stores it, given name first. One person spelled two ways in Zotero gets two notes, such as `[[D Kahneman]]` and `[[Daniel Kahneman]]`. Use one spelling for each person in Zotero.

The line links the item's main creators, such as the person interviewed for an interview. When an item has none of these, the line links its editors, then its directors, then its contributors. When it has no creators at all, the line is empty.
