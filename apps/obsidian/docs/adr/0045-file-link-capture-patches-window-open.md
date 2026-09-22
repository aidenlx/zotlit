# File Link Capture patches `window.open`

A Literature Note already carries Attachment File Links: `zt.attachments[].fileLink`, `zt.annotations[].fileLink` with its `#page=N` anchor, and Attachment Import's blocked-source fallback all write a `file://` URI. Clicking one leaves Obsidian for the system PDF app, and for a path outside the vault Obsidian's main process asks for confirmation first. ZotLit already opens the same file in Obsidian's own reader from four other surfaces. File Link Capture closes that gap by taking the click, and it takes it by patching the global `window.open`.

There is no other complete place to take it. Read against Obsidian 1.14.2: reading view renders `<a class="external-link">`, but Live Preview renders no anchor at all — it keeps the raw Markdown and reads the URL off the CodeMirror syntax tree through `getClickableTokenAt`. Reading view, Live Preview, Properties, and Bases all end at `window.open(href, target)`, and no `Workspace` event fires on a left click. A delegated DOM handler therefore covers reading view and misses Live Preview, which would make one link behave two ways in one note.

Capture claims a click only when `AttachmentResolver` resolves the path to an Obsidian-Openable Attachment. `target === "_external"` is handed to the original before any resolution runs, because that is how Obsidian's own "Open in default browser" item reaches `window.open`. That pass-through is the whole per-link escape hatch: the context menu entry already exists, so Capture adds no menu item of its own.

## Considered Options

- **A delegated click on `a.external-link[href^="file:"]`** (rejected): touches no global, but Live Preview has no anchor to delegate from, so the same link would open in Obsidian in reading view and in the system app while editing.
- **Changing what `fileLink` emits** (rejected): fixes nothing for a note already rendered, and ADR 0043 argues against writing a device-local path into a durable artifact — which `fileLink` already does, and which capture leaves alone rather than entrenching further.
- **Patching `window.open`** (chosen): the one symbol all four click paths share, narrowed to a single scheme and a single resolution rule.

## Consequences

- Capture depends on four undocumented behaviours: that every external-link click ends at the bare global `window.open`, that `"_external"` is the target of Obsidian's own "Open in default browser" item, the `file:`-prefixed linkpath that `Vault.getFileByPath` falls through to the external file manager, and `eState.subpath` as the PDF view's page-jump input. All four join the probe set in `docs/pdf-annotation-probes.md` and are re-verified when `minAppVersion` moves.
- One patch covers pop-out windows. Obsidian's link handlers call the bare global `window.open` — the reason `activeWindow` exists as a separate global — so a click in a pop-out reaches the same patch. The one per-window `containerEl.win.open(...)` in the bundle is the plugin browser's community-page item, which passes `"_external"` and is handed back anyway.
- An in-vault Attachment is found by the casing the clicked link carries. The resolver case-folds per ADR 0035, so a hand-written link whose casing differs from the vault's is claimed, and then `Vault.fileMap`, which holds the real casing, misses it. The user sees the missing-file notice rather than a wrong file. A link ZotLit wrote carries the Zotero row's own casing, which is what the index was built from.
- Selecting the Annotation a link came from is [ADR 0046](./0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md), which reads an Annotation Anchor off the ephemeral state at the leaf and makes the `fileLink` an Annotation renders its first caller.
- An in-vault Attachment is captured to its vault-relative path through `obsidianOpenPath()`, not to the `file:` form, so one file keeps one representation and the PDF annotation editor binds to it. That rule now has two callers.
- `AttachmentResolution` carries the openable verdict. The path index already holds the Attachment row when it builds an entry, so the two rules — is it ours, can Obsidian host it — travel together instead of being recomputed per click.
- A resolution of `pending`, which is what the resolver answers while the Zotero database cannot be read, hands the click back to the system handler. ZotLit does not claim a link it cannot yet identify. A resolved Attachment whose file has since gone shows a notice instead, because the claim was already made.
- The subpath passes through as written, so `#page=N` lands without any work of its own. Obsidian's `&annotation=<id>` names a PDF-native id, not a Zotero key, so it cannot carry a Zotero Annotation.
- `reader.open-file-links` turns Capture off. The patch is still installed and still hands every call to the original, rather than being installed and removed as the setting moves — one fewer moving part, at the price of one property read per external link click.
