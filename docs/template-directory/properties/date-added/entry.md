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

The date has the form of an Obsidian date property, so an Obsidian Bases view can sort your notes by it.

Zotero never changes this date, so an update leaves the property the same.

The date is the day in UTC (Coordinated Universal Time), as Zotero stores it. An item added late in the evening or early in the morning can show the day before or after your local date.
