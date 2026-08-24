---
status: accepted
---

# Cited By Sidebar observes vault-wide citation facts

The Cited By Sidebar follows the active Literature Note's Indexed Key and shows every valid Citation Occurrence in the vault that resolves to the same Item, independent of the Document Citation Set's source choices. The Citation Index exposes one target observation that owns progressive coverage, citekey-resolution status, filtering, invalidation, grouping, and deterministic ordering; the sidebar owns context excerpts, search, collapse state, and navigation.

The first implementation derives each snapshot from the existing per-note scans and Obsidian metadata caches. This keeps reverse persistence and lifecycle rules inside the Citation Index module while allowing a private reverse map later without changing its interface.

## Considered options

- Document Citation Set membership would make an inspection result change with presentation choices.
- A query plus generic change events would make each caller reproduce readiness and invalidation rules.
- A maintained reverse map adds lifecycle complexity before measured performance requires it.
