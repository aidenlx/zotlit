---
title: Links row
summary: One line of links back to the source, to the item in Zotero, its PDF, its DOI, and its web page.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading]
features: [source-links]
problems:
  - I want to open the PDF or the Zotero item straight from my note.
  - My note has no link back to the paper.
keywords:
  - backlink
  - Zotero link
  - open in Zotero
  - PDF link
  - DOI
  - URL
  - web link
audience: Readers who build their own profile and want a way back to the source from every note.
effort: Add the partial to your template folder and call it from your profile's note body.
---

One line of links, separated by middle dots:

- **Zotero** selects the item in Zotero;
- **PDF** opens the item's first PDF in Obsidian, when Obsidian can reach the file;
- **DOI** opens the item's DOI, when it has one;
- **Web page** opens the item's URL, when it has one.

A link the item has no target for is left out, so the row never shows an empty link or a stray separator.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block:

```liquid
{% render "links-row" with zt as zt %}
```
