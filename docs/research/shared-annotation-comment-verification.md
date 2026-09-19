# Shared annotation comment verification

## Run

- Installed root commit: `8068ae05`.
- Obsidian: 1.14.2 on macOS, main window.
- Vault: `45eaad0df9fc4a66`.
- PDF: `attachments/rougier-2014.pdf`.
- Attachment: `RGRPDF24`.
- Annotation: `PUPR5FG5`.
- Zotero database server ID: `A8sf5Zsz8ySw`.

The Annotation Card and PDF Mark Popup showed one shared draft. An update in
either editor appeared in the other editor. The active editor kept focus and
the exact selection `7:12` in both directions.

A real Zotero change produced a conflict between `remote conflict 1163` and
`shared draft delta`. **Keep Zotero's comment** removed the conflict without a
write. A second Zotero change produced a conflict between `newer remote 1163`
and `local winner 1163`. **Use my comment** wrote `local winner 1163` to Zotero.

With `must never resubmit 1163` in an open editor, a confirmed Zotero deletion
removed the Card, Mark, and editor. The deleted Zotero item still held its
previous comment, so editor cleanup did not submit the draft.

After `Zotero.Server.close()`, both editors continued to show
`offline visible 1163`. The controls showed the database read-only reason.
After `Zotero.Server.init()`, editing became available again.

The native main-window scopes handled these gestures:

- macOS Command+Enter in the Popup prevented the key event, wrote
  `command popup submit 1164`, and kept the Popup editor open;
- macOS Command+Enter in the Card prevented the key event and wrote
  `card command submit 1164`;
- Card blur wrote `card blur submit 1164`;
- Card Escape wrote `card escape submit 1164` and closed the editor;
- plain Enter in the Popup was not prevented and kept the editor open; and
- after the Card editor closed, Command+Enter on its page link did not replace
  the newer Zotero value `unrelated shortcut sentinel`.

## Cleanup

The run restored `PUPR5FG5` to `deleted=false` and `comment=null`. The Zotero
HTTP server preference was `true`, and the Local API was initialized. The
plugin reload cleared session drafts. The final layout had zero PDF leaves,
zero Annotation View leaves, and zero comment textareas. The final Obsidian
error buffer was empty, and the debugger was detached.

## Limits

This run verified native scopes in the main Obsidian window. It did not verify
the Card or Popup after migration to a pop-out window. It did not verify a pane
close while a save was pending. The one-second idle save, ten-second burst
limit, serialized slow-write behavior, and failed-save behavior have focused
unit coverage; this run did not measure those timers directly.
