---
title: Date read
summary: An empty date read property on every new literature note, for the date you finish reading, kept on every update.
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
effort: Add one property to your profile in the Properties tab. Enter the date by hand when you finish reading.
expected:
  journal-article: { date-read: null }
  conference-paper: { date-read: null }
  book: { date-read: null }
  book-section: { date-read: null }
  thesis: { date-read: null }
---

An empty `date-read` property on every new literature note, ready for the date you finish reading. An Obsidian Bases view can then sort your notes by it or show what you read in one month.

| Item | `date-read` on a new note |
| --- | --- |
| Journal article | (empty) |
| Book | (empty) |
| Book chapter | (empty) |
| Thesis | (empty) |

Obsidian shows the property with no value until you fill it in.

**When the note is updated**: **Keep the existing value**. ZotLit adds the empty property only when the note's date read is missing or empty. A date you set by hand stays.

So that Obsidian shows a date picker, give the property its type once: in a note, select the icon beside `date-read`, choose **Property type**, then **Date**. Obsidian then uses that type in every note.

Limits: ZotLit does not fill in the date for you; only you know when you finished a source. The **Reading tracker** entry adds this property together with a reading status and a rating.
