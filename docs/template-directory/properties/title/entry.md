---
title: Title
summary: The item's title as a property, written as valid YAML even when it holds a colon or quotation marks.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
recommended: true
problems:
  - I want the paper's title as a property of my note.
  - A colon in the title breaks my YAML.
  - Quotation marks in a title break my properties.
keywords:
  - title
  - frontmatter
  - YAML
  - property
  - Bases
  - Dataview
audience: Readers who show, sort, or search their literature notes by title in an Obsidian Bases view or a table from the Dataview plugin.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { title: Why Most Published Research Findings Are False }
  book: { title: "Thinking, fast and slow" }
  book-section: { title: "Judgment under uncertainty: Heuristics and biases" }
  thesis:
    title: "Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities"
---

The item's title, as a `title` property of the literature note.

| Item | `title` |
| --- | --- |
| Journal article | Why Most Published Research Findings Are False |
| Book | Thinking, fast and slow |
| Book chapter | Judgment under uncertainty: Heuristics and biases |
| Thesis | Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities |

A title with a colon or quotation marks is safe. ZotLit writes the property as valid YAML and adds quotation marks where YAML needs them. When the item has no title, the note gets no `title` property.

**When the note is updated**: **Replace the existing value**. The property always shows the title as Zotero has it. To correct a title, correct it in Zotero, then update the note.

Limits: the property holds the full title with Zotero's capitalization. A title you edit in the note goes back to the Zotero title on the next update. A profile made from the Default profile already has a `title` property. A profile holds each property name once, so edit that property instead of adding a new one.
