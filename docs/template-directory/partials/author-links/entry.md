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

The authors of the item, each as a link to a note named after them, in one line separated by commas: `[[Amos Tversky]], [[Daniel Kahneman]]`. An organization links under its full name.

A link to an author who has no note yet still works: Obsidian creates the note when you select the link. The author's note then lists, under **Backlinks**, every literature note that names them. When an item has no authors, the line links its editors instead, and when it has neither, the partial writes nothing.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block, for example under the title:

```liquid
{% render "author-links" with zt as zt %}
```

The links use the name as Zotero stores it, given name first. The same person with a different spelling in two Zotero items gets two notes, so fix the spelling in Zotero.
