---
title: Publisher by item type
summary: "One publisher property that fits each kind of source: journal, year, volume, issue, and pages for an article, the book and pages for a chapter, otherwise the publisher or university."
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, reading-books, writing]
itemTypes: [journalArticle, book, bookSection, thesis]
features: [properties]
problems:
  - I want one publisher property that works for books, articles, chapters, and theses.
  - My publisher property shows "Vol. null" or a stray "№" when a field is empty.
  - I want the journal, year, volume, issue, and pages of an article in one property.
  - My property template works for articles only.
keywords:
  - publisher
  - journal
  - volume
  - issue
  - pages
  - university
  - source
  - publicationTitle
  - bookTitle
  - item type
  - itemType
  - Vol. null
  - GOST
audience: Readers who keep one publisher property for every source and want it to fit books, articles, book chapters, and theses alike.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { publisher: PLoS Medicine. 2005. }
  journal-article-full-details:
    { publisher: "Econometrica. 1979. Vol. 47. № 2. pp. 263–291." }
  conference-paper: {}
  book: { publisher: Penguin Books }
  thesis: {}
  book-section:
    publisher: "Judgment under Uncertainty: Heuristics and Biases. pp. 3–20."
  letter: {}
  document: { publisher: Brackenridge Free Library }
---

Each part is left out when Zotero has no value for it, so the property never shows an empty `Vol.` or a stray `№`. A hyphen or a long dash in the pages becomes an en dash.

When you update the note, the property follows Zotero. When the item has none of the parts, the note gets no `publisher` property, and an update removes it.

Limits:

- An article shows the year of publication, not the full date.
- A title that ends with a full stop, such as an abbreviation, gets a second full stop.
- The labels `Vol.`, `№`, and `pp.` are text in the rule. To use other labels, such as `No.`, change them in the rule.
