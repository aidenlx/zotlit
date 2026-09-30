---
title: Zotero link
summary: A link in the note's properties that selects the item in Zotero, also as a column in an Obsidian Bases view.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties, source-links]
problems:
  - I want to open the Zotero item from my note's properties.
  - I want a column in my Bases view that opens each paper in Zotero.
  - My note has no link back to Zotero.
keywords:
  - Zotero link
  - backlink
  - zotero://select
  - open in Zotero
  - zotero-link
  - link
audience: Readers who move between Obsidian and Zotero often and want the way back to Zotero in every note's properties.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { zotero-link: "zotero://select/library/items/IANNP5A2" }
  book: { zotero-link: "zotero://select/library/items/NW2CPDTC" }
  book-section: { zotero-link: "zotero://select/library/items/TVKHEUR1" }
  thesis: { zotero-link: "zotero://select/library/items/I49R3FTL" }
---

For an item in a group library, the link names the group, so it selects the item there.

When you update the note, the link follows the item.

The link opens Zotero on a computer where Zotero is installed. It does not open the item on a phone or in a web browser.
