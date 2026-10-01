---
title: Reading tracker
summary: Status, rating, and date-read properties for your own reading progress, so a Bases view can show your unread sources and sort by rating or date.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, reading-books]
features: [properties]
problems:
  - My reading status resets every time the note updates.
  - I want a reading list in Bases split into unread and read papers.
  - How do I rate my papers and record when I read them?
  - My own properties get overwritten when I re-import from Zotero.
keywords:
  - status
  - unread
  - to read
  - reading list
  - reading status
  - rating
  - date read
  - progress
  - persist
  - frontmatter
  - YAML
  - properties
  - Bases
  - Dataview
  - Zotero Integration
  - spread entry
audience: Readers who track what they have read, how useful it was, and when they read it, in an Obsidian Bases view or with the Dataview plugin.
effort: Add one rule to your profile in the Template Workbench. Then set the status, rating, and date in each note by hand.
expected:
  journal-article: { status: unread, rating: null, date-read: null }
  conference-paper: { status: unread, rating: null, date-read: null }
  book: { status: unread, rating: null, date-read: null }
  thesis: { status: unread, rating: null, date-read: null }
  book-section: { status: unread, rating: null, date-read: null }
  letter: { status: unread, rating: null, date-read: null }
  manuscript: { status: unread, rating: null, date-read: null }
  interview: { status: unread, rating: null, date-read: null }
  document: { status: unread, rating: null, date-read: null }
---

A source that you read before you added the rule also starts as `unread`.

An update fills a property only when it is missing or empty. If you delete or clear one, the next update adds it back: `status` as `unread`, the others empty.

To start at another word, change `unread` in the rule and keep the quotation marks. If your look already has a `status` property, as the **Simple reading note** does, the one higher in the **Properties** tab sets the starting word. Select **Remove property** on the other.

In a note, select the icon beside `rating`, then **Property type** > **Number**; do the same for `date-read` with **Date**. Obsidian uses these types in every note.
