# The attachment resolver case-folds on macOS and Windows after separator normalisation

The attachment resolver maps the absolute path of an open Obsidian PDF view to a Zotero Attachment through a plugin-held index that runs `attachmentAbsPath()` across the attachment table, keyed by a normalised path. One pure function in `@zotlit/db` produces that key: separators to `/`, `path.normalize`, no trailing separator, and on `win32` and `darwin` a case fold. The Obsidian side goes through the same function after the `file:` prefix is stripped and `getFullPath()` is applied. Zotero stores a `linked_file` path as it was typed, and Obsidian derives its path from the vault base path, so the same file can arrive in two casings on a case-insensitive volume. A lookup that misses draws nothing and says nothing; a false match would need two files that differ only by case, which those volumes cannot hold.

## Considered Options

- **Exact match after separator normalisation** (rejected): silent misses on the platforms that make up most installs, with no signal to the user that the overlay is empty for a reason.
- **Case fold everywhere** (rejected): a Linux volume can hold both casings as distinct files, so the fold could bind an overlay to the wrong Attachment there.
- **Fold only where the filesystem folds** (chosen): the rule mirrors the platform's own identity rule.

## Consequences

- The index is rebuilt lazily on the first lookup after a database refresh or a resolved Zotero path change; it is never persisted.
- Two Attachments that resolve to one key collide; the resolver prefers the personal library, then the lowest `itemID`, and logs a warning.
- A case-sensitive macOS volume (APFS with case sensitivity enabled) is treated like the default and could, in principle, fold two distinct files; that configuration is rare enough to accept until reported.
