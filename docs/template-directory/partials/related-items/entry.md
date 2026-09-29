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

A **Related items** heading, then one line for each item in the Related section of the item in Zotero, sorted by title. Each line links to that item's literature note under its title, followed by its authors and year: `[[Kahneman2011|Thinking, fast and slow]] (Kahneman, 2011)`.

The link works once the related item has a literature note of its own. When the item has no related items, the partial writes nothing, not even the heading.

The partial reads the note's data and calls the `author-line` partial for the authors, so copy both into your template folder. Call it from the note body of a profile, inside the managed block:

```liquid
{% render "related-items" with zt as zt %}
```
