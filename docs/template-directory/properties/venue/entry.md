---
title: Publication
summary: Where the work appeared, the journal, book, or proceedings, or else the publisher or university.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
recommended: true
problems:
  - I want the journal of each paper as a property.
  - I want to filter my literature notes by journal.
  - My journal property is empty for books.
keywords:
  - venue
  - journal
  - publication
  - publicationTitle
  - proceedings
  - book title
  - publisher
  - container title
  - containerTitle
audience: Readers who group or filter their literature notes by the journal, book, or proceedings a work appeared in.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { venue: PLoS Medicine }
  conference-paper: { venue: Proceedings of the Open Research Conference }
  book: { venue: Penguin Books }
  thesis: {}
  book-section: { venue: "Judgment under Uncertainty: Heuristics and Biases" }
  document: { venue: Brackenridge Free Library }
---

ZotLit uses the publisher, or the university of a thesis, only when the item has no journal, book, or proceedings title in Zotero. When the item has neither, the note gets no `venue` property.

When you update the note, the property follows Zotero.

The property holds a name only, with no volume, issue, or pages. For one property that also holds those, use the **Publisher by item type** entry.
