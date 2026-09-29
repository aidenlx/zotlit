---
title: Reading tracker
summary: Three properties you fill in yourself — status (starts at unread), rating, and date read — that keep your values when the note updates.
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
audience: Readers who track what they have read, how useful it was, and when they read it, in an Obsidian Bases view or with Dataview.
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

Three properties for your own reading progress, from one rule. ZotLit writes them once, when it creates the note. After that they are yours: an update never changes a value you set. Use them for a reading list in an Obsidian Bases view or with Dataview: filter on `status` to split unread sources from read ones, and sort by `rating` or `date-read`.

| Property | Starts as | You change it to |
| --- | --- | --- |
| `status` | `unread` | Your own word, such as `reading`, `read`, or `skimmed` |
| `rating` | Empty | A number, such as `4` |
| `date-read` | Empty | The date you finished the source |

Every kind of source gets the same three properties.

**When the note is updated:** **Keep the existing value**. An update fills a property only when it is empty or missing. So if you delete one of them from a note, the next update adds it back: `status` as `unread`, the others empty.

To add the rule to a profile:

1. In Obsidian, open ZotLit's settings. Under **Profiles**, select **Edit profile** (the pencil button) on the profile you want to change. The Template Workbench opens.
2. Select the **Properties** tab, then **Add several properties from one rule**.
3. In **Value**, replace the example rule with this entry's rule: everything from the first `{` to the last `}`.
4. Set **When the note is updated** to **Keep the existing value**.

To start with another word, such as `to read` or `new`, change `unread` in the rule. If your profile already has a `status` property, as the Simple reading note does, the one higher in the list sets the starting word. Remove one of them, so the word you want is the one used.

So that Obsidian shows a date picker and sorts ratings as numbers, give each property its type once: in a note, select the icon beside `rating`, choose **Property type**, then **Number**; do the same for `date-read` with **Date**. Obsidian then uses those types in every note.
