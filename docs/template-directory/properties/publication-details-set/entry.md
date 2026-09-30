---
title: Publication details by item type
summary: Separate properties for the publication details of each kind of source, such as the journal and volume of an article or the publisher and ISBN of a book.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, reading-books, writing]
itemTypes: [journalArticle, book, bookSection, thesis]
features: [properties]
problems:
  - I want volume, issue, and pages for articles but publisher and ISBN for books.
  - My properties show "Vol. null" or an empty "Issue" when Zotero has no value.
  - Different properties for books and articles.
  - How do I show the book title and editors of a book chapter?
  - How do I show the university of a thesis?
keywords:
  - frontmatter
  - YAML
  - metadata
  - item type
  - itemType
  - journal
  - volume
  - issue
  - pages
  - publisher
  - place
  - edition
  - ISBN
  - book title
  - editors
  - university
  - thesis type
  - publicationTitle
  - Bases
  - Dataview
  - spread entry
audience: Readers who collect articles, books, chapters, and theses and want each note to carry the publication details of its kind of source as properties.
effort: Add one rule to your profile in the Template Workbench. No other setup.
expected:
  journal-article:
    journal: PLoS Medicine
  conference-paper: {}
  book:
    publisher: Penguin Books
  thesis: {}
  book-section:
    book-title: "Judgment under Uncertainty: Heuristics and Biases"
    editors: [Daniel Kahneman, Paul Slovic, Amos Tversky]
    pages: 3–20
  letter: {}
  manuscript: {}
  interview: {}
  document: {}
---

The rule covers four kinds of source: journal article, book, book chapter, and thesis. Other kinds, such as conference papers and letters, get none of these properties. For the journal, book, or proceedings of every source, use the **Publication** entry.

A property is left out when Zotero has no value for it.

When you update the note, each property gets the current value from Zotero, so correct a detail in Zotero. A property that you delete from the note comes back while Zotero has its value. A value that you delete in Zotero, or a property of the old kind after you change the item type, stays in the note until you delete it there.
