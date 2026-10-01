---
title: Authors
summary: Every author of the item as a list of full names, in Zotero's order, so an Obsidian Bases view can find every note by one author.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want all the authors of a paper as a property.
  - I want to find every note by one author in an Obsidian Bases view.
  - My authors property is one long line of text.
keywords:
  - authors
  - author
  - creators
  - fullName
  - names
  - editors
audience: Readers who search or filter their literature notes by author.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { authors: [John P. A. Ioannidis] }
  conference-paper: { authors: [Mara Rivera, Tao Chen] }
  book: { authors: [D Kahneman] }
  book-section: { authors: [Amos Tversky, Daniel Kahneman] }
  thesis: { authors: [Edgard Antunes Dias Batista] }
  interview: { authors: [Ada Okafor] }
  document: { authors: [Brackenridge Free Library] }
---

The list holds the item's main creators: the authors for most items, the interviewee for an interview. The editors of a book chapter are left out. An item with no authors, such as an edited book, gets its editors. When the item has no creators, the note gets no `authors` property.

Each update replaces the list with the current creators from Zotero.

The names are plain text, as Zotero stores them. They are not links to notes about the authors. For a name with the family name first, which sorts well, use the **First author** entry.
