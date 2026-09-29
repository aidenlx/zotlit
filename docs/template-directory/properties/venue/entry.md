---
title: Venue
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

Where the work appeared, as a `venue` property: the journal of an article, the book of a chapter, or the proceedings of a conference paper. An item that appeared in nothing larger, such as a book or a thesis, gets its publisher or its university.

| Item | `venue` |
| --- | --- |
| Journal article | PLoS Medicine |
| Conference paper | Proceedings of the Open Research Conference |
| Book | Penguin Books |
| Book chapter | Judgment under Uncertainty: Heuristics and Biases |
| Thesis | (none: the sample thesis has no university in Zotero) |

When the item has none of these, the note gets no `venue` property.

When the note updates: **Replace the existing value**. The property follows Zotero on every update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile** on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `venue` as the **Property name**.
3. Set **Value format** to **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the property holds a name only, with no volume, issue, or pages. For one property that also holds those, use the **Publisher by item type** entry.
