---
title: Publisher by item type
summary: "One publisher property that fits each kind of source: the publisher of a book, \"Journal. Year. Vol. N. № N. pp. X–Y.\" for an article, the book and pages for a chapter, and the university for a thesis."
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
  conference-paper: {}
  book: { publisher: Penguin Books }
  thesis: {}
  book-section:
    publisher: "Judgment under Uncertainty: Heuristics and Biases. pp. 3–20."
  letter: {}
  document: { publisher: Brackenridge Free Library }
---

One `publisher` property whose text depends on what the item is:

| Item | `publisher` holds | Example |
| --- | --- | --- |
| Journal article | The journal, the year, the volume, the issue, and the pages | PLoS Medicine. 2005. Vol. 2. № 8. pp. e124. |
| Book | The publisher | Penguin Books |
| Book chapter | The title of the book and the pages of the chapter | Judgment under Uncertainty: Heuristics and Biases. pp. 3–20. |
| Thesis | The university | University of Cambridge |
| Any other item | The publisher, when the item has one | Brackenridge Free Library |

Each part is left out when its field in Zotero is empty, so the property never shows `null`, an empty `Vol.`, or a stray `№`. For example, the example journal article has no volume, issue, or pages in Zotero, so its property is `PLoS Medicine. 2005.` The example thesis has no university, so its note gets no `publisher` property. A hyphen or an em dash in the pages becomes an en dash, as in `pp. 10–20`.

**When the note is updated**: **Replace the existing value**. The property follows Zotero on every update. When the item has none of the parts, an update removes the property.

Limits:

- The article form gives the year of publication, not the full date.
- A conference paper, a report, and every other item type get the publisher alone.
- A journal or book title that ends with a full stop, such as an abbreviation, gets a second full stop.
- The labels `Vol.`, `№`, and `pp.` are text in the rule. To use other labels, such as `No.`, change them in the rule.
