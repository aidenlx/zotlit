---
title: PDF literature note
---
# PDF literature note

Use the `all` Scope Case. Open the Library View, select **Why Most Published
Research Findings Are False**, and select **Open PDF**. Its PDF is in Zotero's
storage folder, outside the vault, as a new user's PDFs are.

| Action | Expected result |
| --- | --- |
| Look at the PDF view's header. | **Open literature note** stands beside **Bookmark**. |
| Select **Open literature note**. | The note opens in a split beside the PDF. The PDF stays on screen. |
| Make the PDF tab active and select **Open literature note** again. | The note's tab comes forward. No other tab opens. |
| Make the PDF tab active and run **ZotLit: Open or write literature note for this PDF** from the command palette. | The note's tab comes forward. |
| Open the PDF view's **More options** menu. | **Open literature note** stands with **Split right** and **Open in new window**. Selecting it brings the note's tab forward. |
| Delete the note `literatures/IANNP5A2.md`. | The header action reads **Write literature note**. |
| Select **Write literature note** and choose the **Default** profile. | The note is written and opens beside the PDF. The action reads **Open literature note** again. |
| Keep the note in a background tab and restart Obsidian. Make the PDF tab active and select **Open literature note**. | The restored tab comes forward. No other tab opens. |
| Open `attachments/excerpt-acceptance/excerpt-rendering.pdf`, which no Zotero Attachment keeps. | No literature note action, menu entry or command is offered. |

The desktop check is
`pnpm e2e --project=desktop src/library-view-reading.e2e.ts -t 'offers a PDF view'`.
