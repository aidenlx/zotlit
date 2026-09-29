---
title: Date added
summary: The day you added the item to Zotero, as a date property.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want to sort my literature notes by when I added them to Zotero.
  - I want to see the papers I collected this month.
  - My date added property shows the time and a Z.
keywords:
  - date added
  - dateAdded
  - added
  - created
  - date
  - recently added
audience: Readers who sort or filter their literature notes by when they collected each source.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { date-added: "2025-02-13" }
  conference-paper: { date-added: "2025-01-03" }
  book: { date-added: "2025-05-22" }
  book-section: { date-added: "2025-05-22" }
  thesis: { date-added: "2025-05-22" }
---

The day the item was added to your Zotero library, as a `date-added` property in the form `2025-02-13`. Obsidian reads it as a date, so a Bases view can sort by it or show the items of one month.

| Item | `date-added` |
| --- | --- |
| Journal article | 2025-02-13 |
| Conference paper | 2025-01-03 |
| Book | 2025-05-22 |
| Book chapter | 2025-05-22 |
| Thesis | 2025-05-22 |

When the note updates: **Replace the existing value**. Zotero does not change this date, so the property stays the same.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile** on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `date-added` as the **Property name**.
3. Set **Value format** to **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the date is the day in UTC (Coordinated Universal Time), as Zotero stores it. An item added late in the evening or early in the morning can show the day before or after your local date.
