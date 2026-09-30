---
title: Reading status
summary: A status property that starts at unread, so a Bases view can list the sources that you have not read yet.
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

You change the status by hand as you read, for example to `reading` and then to `read`. It stays the same when you read or annotate in Zotero.

When you update the note, ZotLit writes `unread` only when `status` is missing or empty. A status that you set stays.

To start at another word, such as `to-read`, change the word in the rule and keep the quotation marks. Use the same words in every note, so a view can filter on them.
