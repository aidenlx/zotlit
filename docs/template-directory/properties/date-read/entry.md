---
title: Date read
summary: An empty `date-read` property on every new literature note, for the date you finish reading.
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

Each update keeps the date you enter. ZotLit writes the empty property only when the note's `date-read` is missing or empty.

To get a date picker, give the property its type once: in a note, select the icon beside `date-read`, choose **Property type**, then **Date**. Obsidian then uses that type in every note. An Obsidian Bases view can then sort your notes by it or show what you read in one month.

ZotLit never fills in the date, because only you know when you finished a source. The **Reading tracker** entry adds this property together with a reading status and a rating.
