# Annotation write outcome verification

Paired Run acceptance for issue #1162 exercises the installed Obsidian plugin
against disposable Paired Zotero data. The scenario extends the existing
three-surface write journey and uses one Annotation whose state is also read
independently through Zotero's Local API.

## Controlled outcomes

The lost-response case wraps the installed client's write boundary for one
call. It lets the native request complete first, then withholds that successful
reply from the repository and reports `unknown-outcome`. The real Zotero item
version and distinctive color prove that Zotero committed the write. The next
native list read is made to fail once, which verifies that the Annotation Card
and Annotation Mark retain their prior confirmed color while Zotero holds the
new value.

The wrapper counts calls and delegates exactly once. It does not mock the
native write, its authorization, its version precondition, or the independent
Zotero read. It controls only which completed reply reaches the repository and
whether the immediate recovery read is available.

The test then removes the wrapper and reloads the installed plugin. Both
surfaces must read the committed color from Zotero, while an independent item
read must retain the same version recorded before reload. This proves that the
session-only attempt was not restored or replayed.

The pane-closure case lets another native write commit, pauses delivery of its
successful reply, closes both the PDF pane and Annotation View, then releases
the reply. The repository operation must finish `idle`, the wrapper must record
one request, and an independent Zotero read must show the distinctive color.

## Observed run

The paired run on 2026-09-19 passed all eight selected Fixture scenarios. The
lost-response scenario observed one native request, a higher Zotero item
version with color `#e56b6f`, the prior confirmed Card and Mark color while the
recovery read was unavailable, and the committed color on both surfaces after
plugin reload. The pane-closure scenario observed one request, an `idle`
repository outcome after both panes closed, and color `#2ea8e5` in Zotero. The
PDF digest before and after the run was identical.

## Limits

The lost reply is controlled inside the installed client after the HTTP round
trip completes. It does not reproduce a particular operating-system socket
failure. This is deliberate: the oracle is a real committed Zotero write, and
the controlled boundary makes the otherwise narrow post-commit/pre-reply
interval repeatable without timing sleeps. Unit coverage remains responsible
for classifying individual transport errors.

The scenario uses color because Zotero storage, the PDF Annotation Mark, and
the Annotation Card all expose it independently. Comment draft and autosave
ordering belong to their later shared-draft ticket.
