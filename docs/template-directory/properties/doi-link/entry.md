---
title: DOI link
summary: The item's DOI as a link that opens the publisher's page, left out when the item has no DOI.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, writing]
features: [properties, source-links]
problems:
  - I want a link to the paper's DOI in my note's properties.
  - My DOI property is not a link.
  - My DOI property shows null for books without a DOI.
keywords:
  - DOI
  - doi.org
  - link
  - URL
  - publisher page
  - identifier
audience: Readers who open the published version of a paper from their literature note.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: {}
  book: {}
  book-section: { doi: "https://doi.org/10.1017/CBO9780511809477.002" }
  thesis: {}
---

The item's DOI, as a `doi` property that holds a link to `https://doi.org/`. Obsidian shows the link in the note's properties; select it to open the publisher's page for the work.

| Item | `doi` |
| --- | --- |
| Book chapter | https://doi.org/10.1017/CBO9780511809477.002 |
| Journal article, book, thesis | (no property: the samples have no DOI in Zotero) |

When the item has no DOI, the note gets no `doi` property.

When the note updates: **Replace the existing value**. When you add or correct the DOI in Zotero, the note gets it on its next update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `doi` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. In **Value**, replace the example rule with this entry's rule.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the rule expects Zotero's **DOI** field to hold the DOI itself, such as `10.1017/CBO9780511809477.002`, as Zotero stores it when it imports an item. A DOI field that holds a full link gives a link with the address twice.
