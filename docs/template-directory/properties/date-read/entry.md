---
title: Date read
summary: A date read property that starts at the day of your latest annotation in Zotero and keeps the date you set by hand.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want to record when I read each paper.
  - My date read resets when the note updates.
  - I want to see what I read this month.
keywords:
  - date read
  - dateread
  - read on
  - finished
  - reading log
  - reading tracker
  - persist
  - Bases
audience: Readers who keep a reading log and want each literature note to record when they read the source.
effort: Add one property to your profile in the Properties tab. Correct the date by hand when you finish reading.
expected:
  journal-article: {}
  conference-paper: { date-read: "2025-01-03" }
  book: {}
  book-section: {}
  thesis: {}
---

A `date-read` property in the form `2025-01-03`, which Obsidian reads as a date. It starts at the day of your latest annotation on the item in Zotero, the last day you read and highlighted it. Change it by hand when you finish reading, and a Bases view can show what you read in one month.

| Item | `date-read` |
| --- | --- |
| Conference paper (annotated on 3 January 2025) | 2025-01-03 |
| Journal article, book, book chapter, thesis | (no property: the samples have no annotations) |

An item with no annotations gets no `date-read` property. The property comes on the first update after you annotate the item.

When the note updates: **Keep the existing value**. ZotLit writes the date only when the note has no date read. A date you set by hand stays, and so does the first date ZotLit wrote: later annotations do not change it.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile** on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `date-read` as the **Property name**.
3. Set **Value format** to **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Keep the existing value**.

Limits: the date is the day in UTC (Coordinated Universal Time), as Zotero stores it, so it can be one day before or after your local date. In a group library, the latest annotation can be one that another member made.
