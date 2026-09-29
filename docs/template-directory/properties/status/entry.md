---
title: Reading status
summary: A status property that starts at unread and keeps the status you set by hand.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
recommended: true
problems:
  - I want a reading list of the papers I have not read yet.
  - My reading status resets when the note updates.
  - I want to track which papers I have read.
keywords:
  - status
  - reading status
  - unread
  - to read
  - reading list
  - reading tracker
  - persist
  - Bases
  - Dataview
audience: Readers who keep a reading list in an Obsidian Bases view or a table from the Dataview plugin and change each note's status by hand.
effort: Add one property to your profile in the Properties tab. Change the status by hand as you read.
expected:
  journal-article: { status: unread }
  book: { status: unread }
  book-section: { status: unread }
  thesis: { status: unread }
---

A `status` property that starts at `unread` on every new literature note. You change it by hand as you read, for example to `reading` and then to `read`, and an Obsidian Bases view or a table from the Dataview plugin splits your reading list on it.

| Item | `status` on a new note |
| --- | --- |
| Journal article | unread |
| Book | unread |
| Book chapter | unread |
| Thesis | unread |

When the note updates: **Keep the existing value**. ZotLit writes `unread` only when the note's status is missing or empty. A status you set by hand stays.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `status` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Fixed text**, then select **Change format and reset value**.
4. Enter `unread` into **Value**.
5. Set **When the note is updated** to **Keep the existing value**.

Other common sets of status words are `to-read`, `in-progress`, and `done`, or `unread`, `skimmed`, and `read`. To start at another word, enter that word in step 4. Use the same words in every note, so a view can filter on them.

Limits: the status does not change by itself when you read or annotate. Only you change it.
