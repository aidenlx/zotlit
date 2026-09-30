---
title: Tags
summary: The item's Zotero tags as Obsidian tags, with spaces changed to underscores, added to the tags that the note already has.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
recommended: true
problems:
  - I want my Zotero tags in my literature notes.
  - Tags I add in Obsidian disappear when the note updates.
  - Zotero tags with spaces do not work as Obsidian tags.
  - My notes lose their tags on re-import.
keywords:
  - tags
  - Zotero tags
  - obsidian_tag
  - keywords
  - tag normalization
  - append
  - persist
audience: Readers who tag in Zotero, in Obsidian, or in both, and want every tag kept in the note.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: {}
  book: {}
  thesis: {}
  book-section: { tags: [decision_making, heuristics] }
  letter: { tags: [correspondence] }
---

An update adds each Zotero tag that the note does not have yet. Tags already in the note stay, also those that you add in Obsidian. A tag that you remove in Zotero stays in the note until you delete it there too.

Only the ordinary space changes. A non-breaking space, as in text copied from a PDF, stays and makes the tag not valid. So does another character that Obsidian does not accept in a tag, such as `#` or `&`, and a tag of digits only, such as `2020`. Change such a tag in Zotero or in the note.

When the note has `tags` as text and not as a list, ZotLit adds no tag.
