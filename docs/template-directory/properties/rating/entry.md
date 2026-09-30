---
title: Rating
summary: An empty rating property on every new literature note, for the rating you give by hand, kept on every update.
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

An empty `rating` property on every new literature note, ready for your own rating. After you read, you enter a number, for example from 1 to 5, and an Obsidian Bases view sorts or filters your notes by it.

| Item | `rating` on a new note |
| --- | --- |
| Journal article | (empty) |
| Book | (empty) |
| Book chapter | (empty) |
| Thesis | (empty) |

Obsidian shows the property with no value until you fill it in.

**When the note is updated**: **Keep the existing value**. ZotLit adds the empty property only when the note's rating is missing or empty. A rating you set by hand stays.

So that Obsidian sorts ratings as numbers, give the property its type once: in a note, select the icon beside `rating`, choose **Property type**, then **Number**. Obsidian then uses that type in every note.

Limits: Obsidian shows the rating as a number, not as stars. Choose one scale, such as 1 to 5, and use it in every note. The **Reading tracker** entry adds this property together with a reading status and a date read.
