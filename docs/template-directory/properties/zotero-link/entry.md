---
title: Zotero link
summary: A link that selects the item in Zotero, from the note's properties or from an Obsidian Bases view.
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

The item's Zotero link, as a `zotero-link` property. Obsidian shows the link in the note's properties; select it to select the item in Zotero. An Obsidian Bases view that shows the property gives each row the same link.

| Item | `zotero-link` |
| --- | --- |
| Journal article | zotero://select/library/items/IANNP5A2 |
| Book | zotero://select/library/items/NW2CPDTC |
| Book chapter | zotero://select/library/items/TVKHEUR1 |
| Thesis | zotero://select/library/items/I49R3FTL |

For an item in a group library, the link names the group, so it selects the item there.

When the note updates: **Replace the existing value**. The link follows the item on every update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `zotero-link` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the link opens Zotero on a computer where Zotero is installed. It does not open the item on a phone or in a web browser.
