---
title: Tags
summary: The item's Zotero tags as Obsidian tags, added to the tags already in the note, with spaces changed to underscores.
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

The item's Zotero tags, as the note's `tags` property. Each space in a tag becomes an underscore, because an Obsidian tag cannot hold a space.

| Item | Zotero tags | `tags` |
| --- | --- | --- |
| Book chapter | decision making, heuristics | decision_making, heuristics |
| Letter | correspondence | correspondence |
| Journal article, book, thesis | (none) | (no property) |

**When the note is updated**: **Add to the existing list**. ZotLit adds each Zotero tag the note does not have yet, and keeps every tag already in the note. A tag you add in Obsidian stays. A tag you remove in Zotero stays in the note until you delete it from the note too.

Limits:

- Only the ordinary space changes. The rule does not change these characters, which Obsidian does not accept in a tag: `!` `"` `#` `$` `%` `&` `'` `(` `)` `*` `+` `,` `.` `:` `;` `<` `=` `>` `?` `@` `[` `\` `]` `^` `` ` `` `{` `|` `}` `~`, tabs and other spaces, such as the non-breaking space in text copied from a PDF, curly quotation marks, dashes such as `–` and `—`, and other typographic marks such as `…`. Obsidian also does not accept a tag made of digits only, such as `2020`. A Zotero tag like these comes into the note as written, and Obsidian marks it as an invalid tag. Change such a tag in Zotero, or edit it in the note.
- When the note holds `tags` as text and not as a list, ZotLit leaves it as it is and adds no tag.
