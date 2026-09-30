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

Select the link in the note's properties to open the publisher's page for the work.

Each update writes the DOI from Zotero, so a DOI you add or correct there reaches the note. When you delete the DOI in Zotero, the update removes the property.

The rule expects Zotero's **DOI** field to hold the DOI itself, such as `10.1017/CBO9780511809477.002`, as Zotero stores it when it imports an item. A **DOI** field that holds a full link gives a link with the address twice. Correct the field in Zotero to fix it.
