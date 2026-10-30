---
title: Citation Only Test
---
# Citation Only Test

This note holds one Pandoc citation and no other link, and no note links to it. Its only graph
edge is that citation, so Obsidian's Orphans toggle keeps it while citation edges are on. The
cited work's Literature Note cites a second work, so local-graph depth 2 from here reaches a
second literature node.

Better figures repay the effort [@rougierTenSimpleRules2014].

## Citation Presentation

1. Run **Set citation presentation** on this note. The dialog shows the note's
   current style and language, with the vault choices available as defaults.
2. Enter `de-DE` as the language and confirm. The note gains `lang: de-DE` and
   keeps its title and body. Reopen the dialog: it shows `de-DE`.
3. Enter `fr-FR` and cancel. The note keeps `de-DE`.
4. Open the dialog again and disable ZotLit. The dialog closes and the note keeps
   `de-DE`. Enable ZotLit again before continuing.
5. Clear the language and confirm to return to the vault language.

If the note cannot be written, confirmation shows the existing failure notice.
The failed operation leaves the note's previous text in place. If confirmation
has started a save, disabling ZotLit waits for that save to finish. A failed save
still shows its failure notice.
