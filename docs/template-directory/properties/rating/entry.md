---
title: Rating
summary: An empty rating property on every literature note, for the score that you give each source by hand, so a Bases view can sort your reading by it.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want to rate the papers I read.
  - My rating resets when the note updates.
  - I want to sort my reading list by how important each paper is.
keywords:
  - rating
  - stars
  - score
  - importance
  - priority
  - reading tracker
  - persist
  - Bases
audience: Readers who rate each source by hand and sort or filter their literature notes by that rating.
effort: Add one property to your profile in the Properties tab. Set the rating by hand after you read.
expected:
  journal-article: { rating: null }
  book: { rating: null }
  book-section: { rating: null }
  thesis: { rating: null }
---

When you update the note, ZotLit adds the empty property only when `rating` is missing or empty. A rating that you enter stays.

To make Obsidian sort ratings as numbers, set the type once. In a note, select the icon next to `rating`, then select **Property type** and **Number**. Obsidian uses this type in every note.

Obsidian shows the rating as a number, not as stars. Use one scale, such as 1 to 5, in every note. The **Reading tracker** entry adds this property together with a reading status and a date read.
