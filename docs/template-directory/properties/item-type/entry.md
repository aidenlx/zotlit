---
title: Item type
summary: The kind of source as a readable name, such as Journal Article or Book Section, so you can group and filter your notes by it.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, archival-research]
features: [properties]
problems:
  - I want to see if a note is about a book or an article.
  - My item type property shows journalArticle or bookSection.
  - I want to group my literature notes by kind of source.
keywords:
  - item type
  - itemType
  - type
  - kind of source
  - journalArticle
  - bookSection
  - label
audience: Readers who group or filter their literature notes by the kind of source.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { item-type: Journal Article }
  conference-paper: { item-type: Conference Paper }
  book: { item-type: Book }
  thesis: { item-type: Thesis }
  book-section: { item-type: Book Section }
  letter: { item-type: Letter }
  manuscript: { item-type: Manuscript }
  interview: { item-type: Interview }
  document: { item-type: Document }
---

The rule holds an English name for each Zotero item type. To use your own word, such as `Article` for a journal article, change that name in the rule.

When you change the item type in Zotero, the next update writes the new name.

An item type that a later Zotero version adds shows Zotero's internal name for it, until you add a name for it to the rule.
