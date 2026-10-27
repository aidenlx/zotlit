---
title: Excerpt display
---
# Excerpt display

Use the `all` Scope Case. In the Library View, open the Literature Note for
**Ten Simple Rules for Better Figures**, then show its Annotations. Its image
and ink cards are the subjects of these checks.

| Action | Expected result |
| --- | --- |
| Show the image and ink cards with the PDF reader closed. | Each card displays its excerpt. Opening the PDF reader preserves the same excerpt. |
| Refresh the Annotation View. | Each card keeps its previous image while the replacement is read, then displays the current image. |
| Close and reopen the Annotation View. | The stored image appears while the current pixels are read. |
| In a Paired Run, save an ink colour change, then save a second colour before its replacement finishes. | The card finishes with the second saved colour. An older result does not replace it. |
| In a Paired Run, close the card, save an ink colour change, then reopen the card. | A previously displayed image is refreshed even while its card is closed. |
| Clear the excerpt cache in ZotLit settings. | Mounted cards release their images. A new demand can load them again. |
| Refresh, then disable ZotLit while a read is pending. Enable ZotLit and reopen the card. | The pending read stops at unload. The new card displays the current saved excerpt. |

Saved edits require the disposable Fixture's Paired Zotero and editing permission.
The deterministic unload checks also run in `display-lifecycle.test.ts`; the
desktop checks are in `annotations-excerpts.e2e.ts` and `follow-mode.e2e.ts`.
