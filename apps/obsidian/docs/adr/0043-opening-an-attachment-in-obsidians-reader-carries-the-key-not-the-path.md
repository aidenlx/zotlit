# Opening an Attachment in Obsidian's reader carries the key, not the path

The Companion offers "Open PDF in Obsidian" on an item row, an attachment row, and the Reader page menu. Obsidian can host a file that lives outside the vault: `Vault.getFileByPath` falls through to the external file manager when the path carries a `file:` prefix, and the built-in `obsidian://open?file=file:<abs>` reaches that fall-through, both verified live on 1.14.2. ZotLit uses neither. It sends its own action, `obsidian://zotlit/open-attachment?item=<id>&source-id=<hash>`, carrying the Zotero id alone, and resolves the path on the Obsidian side through `attachmentAbsPath()`. A Public URI Link is a permanent, embeddable artifact, so an absolute path written into one is a device-local fact in a contract that promises to outlive the device. The built-in form also carries no Source Id, which is the sole targeting gate: a link that names a path reaches whichever vault answers, not the configured install. Resolution stays in one place as a result, beside the resolver that already runs it in the other direction.

## Considered Options

- **The built-in `obsidian://open?file=file:<abs>`** (rejected): fewer moving parts and demonstrably working, but it bakes a device-local path into a permanent link and drops the Source Id gate that aims an action at one install.
- **A ZotLit action carrying a path** (rejected): keeps the gate, keeps the staleness, and still leaves Zotero resolving paths that `@zotlit/db` already knows how to resolve.
- **A ZotLit action carrying the Zotero id** (chosen): the payload stays valid wherever the link travels, and one side owns path resolution.

## Consequences

- `open-attachment` is a frozen contract from its first release, per ADR 0006. It takes one numeric `item`, which may name a regular item or an attachment, and Obsidian branches on which it finds. `PROTOCOL_VERSION` does not move, because the URL transport carries no version.
- The `file:` prefix is undocumented. It is read from the 1.14.2 bundle and confirmed live on that version alone, so an Obsidian upgrade is a place this can break silently; the feature fails to a notice rather than to a wrong file.
- An Attachment already inside the vault opens by its vault-relative path. `Vault.fileMap` is keyed that way, so the `file:` spelling would miss it and build a second representation of one file, and the PDF annotation editor binds per path.
- The two readers disagree on what qualifies, and the glossary says so: a Zotero-Openable Attachment is any file the path names, an Obsidian-Openable Attachment is a PDF. One seam carries both rules.
