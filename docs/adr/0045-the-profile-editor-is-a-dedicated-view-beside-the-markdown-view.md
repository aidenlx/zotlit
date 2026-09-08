# The Profile Editor is a dedicated view beside the Markdown view

> Amended 2026-09-08: both hosts render on the calling thread with no deadline; the web render Worker and the scheduler's deadline are removed, because the real note creation has the same exposure and the protection guarded only the milder host.

Map #835 first framed the Obsidian port of the web Workbench as CodeMirror extensions mounted inside Obsidian's Markdown view, with forms, preview, and explorer staying web-only. Decided in the Profile Editor grilling (2026-09-07): the Profile Editor is its own main-area view, a `TextFileView` subclass with its own view type, opened on a Profile document by Customize, a file-menu item, a command, and an "Open in profile editor" header action on the Markdown view. Inside it runs the shared master/slice document controller from `@zotlit/workbench/document`, so the tabs, Properties rows, Match tab, and Advanced slice work exactly as on the web with one undo history. The view autosaves the way Obsidian saves any note; an invalid document stays invalid on disk with its diagnostics in Problems and on the settings row, which is what [ADR 0031](0031-a-literature-note-profile-is-its-document.md) already allows for a hand-edited file. External changes to the file arrive as one controller transaction that keeps the undo history. The Template Data Explorer and the new Note Preview are sidebar leaves that follow the active Profile Editor the way Outline follows the active note, so the three-column frame of the web stays web-only layout. The Note Preview renders through the plugin's real template pipeline with the Explorer's inert resolvers and displays through `MarkdownRenderer`, sharing only the result contract with the web renderer; in update mode it shows the real Literature Note with its managed parts replaced when one exists.

## Considered options

- **Augment the Markdown view with the shared extensions**: keeps one editor, but the master/slice model cannot run inside Obsidian's single editor, so Properties rows and the Annotation tab would need a second implementation.
- **A split pane inside the view for the preview**: mirrors the web, but takes the pane choice away from the user; Obsidian's leaves already give move, pin, and close.
- **Explicit Save with the web's blocking rule**: a second save model in the same app; the blocking rule is now recorded as the web's connected-Save transport rule in [ADR 0032](0032-web-workbench-edits-one-source-document.md).
- **Reusing the web renderer in Obsidian**: no Eta, no CSL, and a Markdown renderer that is not Obsidian's; the preview would lie about wikilinks and citation styles.

## Consequences

- The Markdown view remains a full editor for the same file; the two views are one click apart.
- The JavaScript Templates gate governs rendering only; the Profile Editor edits an Eta or `js` document at any time.
- The built-in Default opens as a draft over the built-in source; the first change creates `zotlit-profile.default.md`, which is the Eject.
- Run/Stop in the Note Preview pauses live rendering; a render in flight completes, because the pipeline runs on the main thread.
