# Note Import

When a Zotero item has child notes, ZotLit can import them as standalone Markdown files in the vault and link to them from the literature note.

## How import is triggered

Import is **link-driven**. When a template or frontmatter expression calls `noteLink()` on a child note, ZotLit imports that note as a Markdown file. If `noteLink()` is never called — because your template or frontmatter does not use it — no file is created for that child note.

## When import runs

Import runs during every literature-note operation — create, update, and overwrite. The parts of the literature note that are re-rendered depend on the operation:

| | Create | Update (full) | Update (metadata) | Overwrite |
|---|---|---|---|---|
| Note body | full | managed region | — | full |
| Frontmatter | yes | yes | yes | yes |

Any re-rendered part that calls `noteLink()` can trigger import. A metadata-only update re-evaluates frontmatter expressions, so a frontmatter field that calls `noteLink()` creates child-note files even though the body is untouched.

## Create-only — no implicit updates

Imported notes are **created once and never updated**. If an imported file already exists for a child note, `noteLink()` links to the existing file without re-importing. Editing the Zotero note afterward does not change the imported file.

## Imported note structure

Each imported note is a Markdown file with frontmatter:

```yaml
---
date: "2025-03-15T10:30:00"
zotero-note-key: "ABC12345"
---
```

| Field | Description |
|---|---|
| `date` | When the note was added to Zotero, as a local datetime |
| `zotero-note-key` | Identity key used to match the imported file to the Zotero note |

The body is the Zotero note's HTML converted to Markdown. Citations in the note are resolved through your cite template.

## Annotations

When you use Zotero's "Add to note", each annotation becomes its own paragraph — a highlighted or underlined excerpt, or an image excerpt — usually followed by a citation. By default the excerpt is kept as-is, with its highlight color and a link back to Zotero.

Turn on **Settings > Note > Render annotations from template** to render those paragraphs through your `annotation` template instead — the same rich callout the literature note uses.

With the setting on, each annotation's text, comment, color, page, and image are taken **fresh from Zotero**, so edits you made to that paragraph inside the note are replaced. That is why the setting is off by default.

### What gets rendered from the template

Only paragraphs that still look the way Zotero originally inserted them are rendered from the template. A paragraph you've edited is left untouched (and keeps your text) when:

- you typed text **before** the excerpt, or
- you added anything else to it — a second annotation, extra formatting, and so on, or
- the annotation was **deleted** in Zotero.

> [!NOTE]
> **Note and text annotations are never rendered from the template.** A standalone note (sticky-note) or text-box annotation carries no highlighted or underlined excerpt and no image — Zotero inserts it as just a citation and its comment. That paragraph has no annotation identity for ZotLit to match back to Zotero, so it is kept as Zotero inserted it (citation resolved through your cite template, comment as plain text). Only highlight, underline, and image annotations render through the `annotation` template.

> [!WARNING]
> Text you add **after the citation** is the one edit that is not protected. Zotero puts the annotation's own comment in that same spot, so it can't be told apart from a note you typed there — when the setting is on, it is replaced along with the rest. Put notes you want to keep in a separate paragraph.

## Import folder

Imported notes are written to the folder configured in Settings > Note > Import folder (default `zotero_notes`). The folder is created automatically if it does not exist. Each filename includes a short random suffix to guarantee uniqueness.

## Using `zt.notes` in templates and frontmatter

`zt.notes` is available in note, content, and frontmatter templates. See [Notes shape](data-reference.md#notes-shape) for the property reference.

To list child-note links in frontmatter, add a field with expression `zt.notes.map(n => n.noteLink())` — the same pattern as the default `related` field. Calling `noteLink()` triggers import, so the files are created even when notes only appear in frontmatter.

To list titles without triggering import, use `zt.notes.map(n => n.title).filter(Boolean)`.
