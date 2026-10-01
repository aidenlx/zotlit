---
title: First author
summary: The first author, family name first, so that notes sort by author.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want to sort my literature notes by first author.
  - I want the first author as a property, not every author.
  - My author column sorts by first names.
keywords:
  - first author
  - author
  - FirstAuthor
  - creators[0]
  - family name
  - last name
  - surname
  - sort by author
audience: Readers who sort or group their literature notes by first author in an Obsidian Bases view or a table from the Dataview plugin.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { first-author: "Ioannidis, John P. A." }
  conference-paper: { first-author: "Rivera, Mara" }
  book: { first-author: "Kahneman, D" }
  book-section: { first-author: "Tversky, Amos" }
  thesis: { first-author: "Batista, Edgard Antunes Dias" }
  document: { first-author: Brackenridge Free Library }
---

An organization keeps its name as written. A creator with no given name shows the family name alone. When the item has no creators, the note gets no `first-author` property.

The first author is the first of the item's main creators, as in the **Authors** entry. For an edited book with no authors, it is the first editor. The name is as complete as Zotero has it, so a given name stored as an initial stays an initial.

Each update replaces the value with the current first author from Zotero.
