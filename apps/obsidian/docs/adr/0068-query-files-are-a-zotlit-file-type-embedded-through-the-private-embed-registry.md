# Query Files are a ZotLit file type, embedded through Obsidian's private embed registry

A Query File is a `.zotquery` vault file that opens in a ZotLit tab view and embeds in a note with `![[file.zotquery]]` or `![[file.zotquery#View]]`. Its text keeps the shape of an Obsidian `.base` file (`filters`, `formulas`, `properties`, `summaries`, `views`), and ZotLit Query answers it. Obsidian's public API registers a file type (`registerExtensions` with a `TextFileView`), but only the private `app.embedRegistry` renders `![[x.ext]]` for that type; Bases uses the same registry. ZotLit calls it from one guarded module. When the registry is missing, the embed falls back to a link to the file, and the Query Block keeps working because it uses only public API.

Proposed on 2026-10-14 with [#1459](https://github.com/aidenlx/zotlit/issues/1459), which replaces [#1275](https://github.com/aidenlx/zotlit/issues/1275).

## Considered Options

- **A view type inside Obsidian Bases** (`registerBasesView`, rejected): Obsidian keeps the toolbar, filters and file, but each row is a `BasesEntry` with a vault `TFile`. Zotero Items, Attachments, Annotations and notes are not vault files, and a Bases view cannot add its own data source, fields or functions.
- **A Markdown note that holds a Query Block** (rejected): public API only, but the file is an ordinary note in search, the graph and the file list, not a separate object a researcher names and reuses.
- **A `.zotquery` file with a private embed** (chosen).

## Consequences

- An Obsidian update can change or remove `embedRegistry`; the guarded module is the one place to fix, and the plugin review can flag the call.
- ZotLit builds its own toolbar, sort, group, properties and results controls. The filter control reuses the Template Workbench Match editor, which already writes Filter Expressions.
- `.base` key names are kept where the meaning is the same, so a researcher who knows Bases can read a Query File.
