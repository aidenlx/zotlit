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

The property is a number, so a Bases view sorts 1982 before 2005.

ZotLit takes the year that Zotero reads from the date, as in `2005`, `March 2005`, or `2005-03-14`. When the date holds no year, the note gets no `year` property.

When you update the note, the property follows the date in Zotero.
