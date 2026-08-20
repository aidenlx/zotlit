# Chrome injection

Use a Zotero plugin registry wherever one exists — `MenuManager`, `ItemTreeManager`, `Reader.registerEventListener`, `PreferencePanes`. Build nodes with `document.createXULElement` only for a surface no registry covers.

- Own every hand-injected node: remove it from each still-open window on disposal, and look up rather than touch closed ones (`src/notify/active-reader.ts` holds the pattern).
- Append outside any container Zotero rebuilds or enumerates — a node inside one is wiped on rebuild, or silently occupies a slot in its index.
- Rationale and the rejected registry route: [ADR 0023](../../../docs/adr/0023-companion-hand-injects-chrome-only-where-zotero-offers-no-registry.md).
