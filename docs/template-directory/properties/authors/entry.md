---
title: Authors
summary: Every author of the item as a list of full names, in Zotero's order.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want all the authors of a paper as a property.
  - I want to find every note by one author in a Bases view.
  - My authors property is one long line of text.
keywords:
  - authors
  - author
  - creators
  - fullName
  - names
  - editors
audience: Readers who search or filter their literature notes by author.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { authors: [John P. A. Ioannidis] }
  conference-paper: { authors: [Mara Rivera, Tao Chen] }
  book: { authors: [D Kahneman] }
  book-section: { authors: [Amos Tversky, Daniel Kahneman] }
  thesis: { authors: [Edgard Antunes Dias Batista] }
  interview: { authors: [Ada Okafor] }
  document: { authors: [Brackenridge Free Library] }
---

The item's authors, as an `authors` list property with one full name per entry, in the order Zotero lists them. Obsidian shows a list property as separate values, so a Bases view can find every note that names one author.

| Item | `authors` |
| --- | --- |
| Journal article | John P. A. Ioannidis |
| Conference paper | Mara Rivera, Tao Chen |
| Book | D Kahneman |
| Book chapter | Amos Tversky, Daniel Kahneman |
| Thesis | Edgard Antunes Dias Batista |
| Interview | Ada Okafor (the interviewee) |
| Document by an organization | Brackenridge Free Library |

The list holds the item's main creators: the authors for most items, the interviewee for an interview. The editors of a book chapter are left out. For an item with no authors, such as an edited book, the list holds the editors. When the item has no creators, the note gets no `authors` property.

When the note updates: **Replace the existing value**. The list follows Zotero on every update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile** on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `authors` as the **Property name**.
3. Set **Value format** to **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: names are plain text, given name first, as Zotero stores them. They are not links to notes about the authors. For a sortable name with the family name first, use the **First author** entry.
