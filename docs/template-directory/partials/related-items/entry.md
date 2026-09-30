---
title: Related items
summary: The items you linked in Zotero's Related section, as links to their literature notes under a "Related items" heading.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading, literature-review]
features: [related-items]
problems:
  - I want the related items from Zotero in my note.
  - I want to move between connected papers.
  - My Zotero relations do not show in Obsidian.
keywords:
  - related
  - relations
  - relatedItems
  - see also
  - connected papers
  - links
  - graph view
audience: Readers who link items in Zotero's Related section and want to follow those links between literature notes.
effort: Add this partial and the author-line partial to your template folder, and call this one from your profile's note body.
---

The lines are sorted by title. Each link goes to the name that the **Note name** of your look gives the related item; the example uses its citation key. The link works once the related item has a literature note of its own. When ZotLit cannot name that note, the line shows the title as plain text. A related item with no authors or no year shows without that part.

The partial calls the **Author line** partial for the authors, so add both to your template folder.
