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

The item's first author, as a `first-author` property in the form "Family name, Given name". A view that sorts on it lists your notes in the order of a reference list.

| Item | `first-author` |
| --- | --- |
| Journal article | Ioannidis, John P. A. |
| Conference paper (two authors) | Rivera, Mara |
| Book | Kahneman, D |
| Book chapter | Tversky, Amos |
| Thesis | Batista, Edgard Antunes Dias |
| Document by an organization | Brackenridge Free Library |

An organization keeps its name as written. A name with no given name shows the family name alone. When the item has no creators, the note gets no `first-author` property.

**When the note is updated**: **Replace the existing value**. The property follows Zotero on every update.

Limits: the first author is the first of the item's main creators, as in the **Authors** entry: for an edited book with no authors, the first editor. The name is as complete as Zotero has it, so an author stored as `D Kahneman` shows as `Kahneman, D`.
