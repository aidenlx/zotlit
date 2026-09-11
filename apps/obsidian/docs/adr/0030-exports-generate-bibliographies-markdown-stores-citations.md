---
status: accepted
---

# Exports generate bibliographies; Markdown stores citations

ZotLit treats a bibliography as generated output. Markdown files store Citations, and each export generates its bibliography from those Citations. The References Sidebar can copy a complete current rendering as a Copied Bibliography for use elsewhere, but ZotLit does not insert or maintain bibliography content in Markdown.

## Consequences

- A Copied Bibliography is an unmanaged point-in-time snapshot. It does not update after the user pastes it.
- Copy follows the active file's Document Citation Set and Citation and References Style. Export keeps its separate citation-membership and bibliography-data contracts.
- Copy is available only for a non-empty, current, complete, error-free bibliography rendering. A refresh makes the prior rendering unavailable for copy.
- ZotLit provides no bibliography insertion command, bibliography Template, or managed bibliography region.

## Considered options

- Insert a static bibliography into Markdown: rejected because source, item metadata, locale, and style changes can leave plausible but stale content.
- Maintain a ZotLit-owned bibliography region: rejected because it makes arbitrary Markdown files share ownership with a new refresh and conflict lifecycle.
