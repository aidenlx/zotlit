---
title: Title
summary: The item's title as a property, written as valid YAML even when the title has a colon or quotation marks.
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

When you update the note, the property gets the title from Zotero again, with Zotero's capitalization. A title that you edit in the note goes back to the Zotero title, so correct a title in Zotero. When the item has no title, the note gets no `title` property.

The **Default** look, and every look that you made from it, already has a `title` property. A look with the same property name twice does not load, so change that property in place of adding a second one.
