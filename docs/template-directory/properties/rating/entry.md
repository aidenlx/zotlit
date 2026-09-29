---
title: Rating
summary: A rating property that starts at 0, not rated, and keeps the rating you set by hand.
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
  journal-article: { rating: 0 }
  book: { rating: 0 }
  book-section: { rating: 0 }
  thesis: { rating: 0 }
---

A `rating` property that holds a number. It starts at `0`, which means "not rated yet", on every new literature note. After you read, you change it by hand, for example to a number from 1 to 5, and a Bases view sorts or filters your notes by it.

| Item | `rating` on a new note |
| --- | --- |
| Journal article | 0 |
| Book | 0 |
| Book chapter | 0 |
| Thesis | 0 |

When the note updates: **Keep the existing value**. ZotLit writes `0` only when the note has no rating. A rating you set by hand stays.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile** on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `rating` as the **Property name**.
3. Set **Value format** to **Rule · JSON-e**, then select **Change format and reset value**.
4. Enter `0` into **Value**.
5. Set **When the note is updated** to **Keep the existing value**.

Limits: Obsidian shows the rating as a number, not as stars. Choose one scale, such as 1 to 5, and use it in every note.
