---
title: Year
summary: The year of publication as a number, ready to sort and filter by.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
recommended: true
problems:
  - I want to sort my literature notes by year.
  - I want a year property that Bases reads as a number.
  - My date property shows the whole date when I only want the year.
keywords:
  - year
  - date
  - publication year
  - date.year
  - sort by year
  - Bases
  - Dataview
audience: Readers who sort, group, or filter their literature notes by year of publication.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { year: 2005 }
  book: { year: 2011 }
  book-section: { year: 1982 }
  thesis: { year: 2010 }
  letter: { year: 1887 }
---

The year of publication, as a `year` property that holds a number. An Obsidian Bases view or a table from the Dataview plugin sorts it as a number, so 1982 comes before 2005.

| Item | `year` |
| --- | --- |
| Journal article | 2005 |
| Book | 2011 |
| Book chapter | 1982 |
| Thesis | 2010 |
| Letter dated 14 March 1887 | 1887 |

When the item's date in Zotero has no year, the note gets no `year` property.

**When the note is updated**: **Replace the existing value**. The property follows the date in Zotero on every update.

Limits: the property holds the year only. Zotero must be able to read a year from the date, as it does for `2005`, `March 2005`, and `2005-03-14`.
