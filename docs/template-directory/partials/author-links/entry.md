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

A link to an author who has no note yet still works: Obsidian creates the note when you select the link. The author's note then lists, under **Backlinks**, every literature note that names them. The line links the item's main creators: the authors for most items, or the main role for the item type, such as the person interviewed for an interview. When an item has none of these, the line links its editors, then its directors, then its contributors, and when it has none at all, the partial writes nothing.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block, for example under the title:

```liquid
{% render "author-links" with zt as zt -%}
```

The links use the name as Zotero stores it, given name first. The same person with a different spelling in two Zotero items gets two notes, and so does a person whose given name is an initial in one item, such as `[[D Kahneman]]` and `[[Daniel Kahneman]]`. Use one spelling for each person in Zotero.
