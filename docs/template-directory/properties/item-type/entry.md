---
title: Item type
summary: The kind of source in words, such as Journal Article or Book Section, in place of Zotero's internal name.
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

The kind of source, as an `item-type` property that uses Zotero's English name for the item type, the name you see in Zotero's **Item Type** field.

| Item | `item-type` |
| --- | --- |
| Journal article | Journal Article |
| Book | Book |
| Book chapter | Book Section |
| Thesis | Thesis |
| Letter | Letter |

The rule holds a name for each of Zotero's item types. To use your own word, such as `Article` for a journal article or `Chapter` for a book section, change that name in the rule.

When the note updates: **Replace the existing value**. When you change the item type in Zotero, the note gets the new name on its next update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `item-type` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. In **Value**, replace the example rule with this entry's rule.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the names are in English. An item type that a later Zotero version adds shows its internal name, such as `journalArticle`, until you add a name for it to the rule.
