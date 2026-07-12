# Note Import

When a Zotero item has child notes, ZotLit can import them as standalone Markdown files in the vault and link to them from the literature note.

## How import is triggered

Import is **link-driven**. When a template or frontmatter expression references `noteLink` on a child note, ZotLit imports that note as a Markdown file. If `noteLink` is never referenced -- because your template or frontmatter does not use it -- no file is created for that child note.

In templates: `{{ note.noteLink }}` (a property access -- Liquid auto-invokes the function-valued `noteLink` property).
In frontmatter: `zt.notes | map: "noteLink"` (Liquid) or `zt.notes.map(n => n.noteLink())` (JavaScript).

## When import runs

Import runs during every literature-note operation -- create, update, and overwrite. The parts of the literature note that are re-rendered depend on the operation:

| | Create | Update (full) | Update (metadata) | Overwrite |
|---|---|---|---|---|
| Note body | full | managed region | -- | full |
| Frontmatter | yes | yes | yes | yes |

Any re-rendered part that references `noteLink` can trigger import. A metadata-only update re-evaluates frontmatter expressions, so a frontmatter field that references `noteLink` creates child-note files even though the body is untouched.

## Create-only semantics

Imported notes are **created once and never updated**. If an imported file already exists for a child note, `noteLink` links to the existing file without re-importing. Editing the Zotero note afterward does not change the imported file.

Batch re-import (available from the command palette) can overwrite existing imported notes. It compares the `zotero-lastmod` frontmatter value against the live `dateModified` in Zotero and skips notes that have not changed -- those appear in an "Up to date" group in the batch modal.

## Imported note structure

Each imported note is a Markdown file with frontmatter:

```yaml
---
date: "2025-03-15T10:30:00-04:00"
zotero-note-key: "ABC12345"
zotero-lastmod: "2025-03-15T14:45:00-04:00"
---
```

| Field | Description |
|---|---|
| `date` | When the note was added to Zotero, as a local datetime with offset (ISO 8601) |
| `zotero-note-key` | Identity key used to match the imported file to the Zotero note |
| `zotero-lastmod` | The source note's Zotero `dateModified` timestamp, as a local datetime with offset (ISO 8601 — same format as `date`). Stamped on every write. Used by batch re-import to skip notes that have not changed in Zotero |

The body is the Zotero note's HTML converted to Markdown. Citations in the note are resolved through your cite template.

## Annotations in notes

When you use Zotero's "Add to note", each annotation becomes its own paragraph -- a highlighted or underlined excerpt, or an image excerpt -- usually followed by a citation. By default the excerpt is kept as-is, with its highlight color and a link back to Zotero.

Turn on **Settings > Note import > Render annotations from template** to render those paragraphs through your `annotation` template instead -- the same rich callout the literature note uses.

With the setting on, each annotation's text, comment, color, page, and image are taken **fresh from Zotero**, so edits you made to that paragraph inside the note are replaced. That is why the setting is off by default.

### What gets rendered from the template

Only paragraphs that still look the way Zotero originally inserted them are rendered from the template. A paragraph you've edited is left untouched (and keeps your text) when:

- you typed text **before** the excerpt, or
- you added anything else to it -- a second annotation, extra formatting, and so on, or
- the annotation was **deleted** in Zotero.

> [!NOTE]
> **Note and text annotations are never rendered from the template.** A standalone note (sticky-note) or text-box annotation carries no highlighted or underlined excerpt and no image -- Zotero inserts it as just a citation and its comment. That paragraph has no annotation identity for ZotLit to match back to Zotero, so it is kept as Zotero inserted it (citation resolved through your cite template, comment as plain text). Only highlight, underline, and image annotations render through the `annotation` template.

> [!WARNING]
> Text you add **after the citation** is the one edit that is not protected. Zotero puts the annotation's own comment in that same spot, so it can't be told apart from a note you typed there -- when the setting is on, it is replaced along with the rest. Put notes you want to keep in a separate paragraph.

## Import folder

Imported notes are written to the folder configured in Settings > Note import > Imported note folder (default `zotero_notes`). The folder is created automatically if it does not exist. Each filename includes a short random suffix to guarantee uniqueness.

## Using notes in templates

```liquid
{% if zt.notes.size > 0 %}
## Notes

{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor %}
{% endif %}
```

To list titles without triggering import, use `{{ zt.notes | map: "title" | compact | join: ", " }}` in a template -- property access on `title` does not trigger import; only `noteLink` does.

The same rule applies in frontmatter: `zt.notes | map: "title" | compact` lists titles without importing, while `zt.notes | map: "noteLink"` triggers import for every child note (the same pattern as the default `related` field, see [Frontmatter](frontmatter.md#default-user-fields)).
