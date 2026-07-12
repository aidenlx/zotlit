# Template System

ZotLit renders literature notes, citations, and filenames through templates. Templates are Markdown files with embedded expressions and logic that shape what your notes look like.

## Template types

| Type         | Purpose                                                     | Vault file                      |
| ------------ | ------------------------------------------------------------ | -------------------------------- |
| `note`       | The literature note created for a Zotero item                | `zotlit-note.liquid.md`          |
| `content`    | The managed region (child notes + annotations), re-rendered on update | `zotlit-content.liquid.md`       |
| `annotation` | A single annotation/highlight rendered into the note         | `zotlit-annotation.liquid.md`    |
| `cite`       | An in-text citation link                                     | `zotlit-cite.liquid.md`          |
| `cite2`      | An alternate in-text citation format                         | `zotlit-cite2.liquid.md`         |
| `filename`   | The generated filename for a literature note                | `zotlit-filename.liquid.md`      |

## Choosing a language

Liquid is the default template language — it's always active, and you don't need to do anything to use it. Every template type above ships with a Liquid default that you can customize.

For advanced use cases, ZotLit also supports Eta ("JavaScript Templates"), which lets templates run arbitrary JavaScript expressions. Because that carries a larger security surface, Eta is off by default and must be turned on per device via the JavaScript templates setting. See [JavaScript Templates](javascript-templates.md) for how to enable it and what it protects against.

Templates are matched by filename: `zotlit-<name>.liquid.md` for Liquid, `zotlit-<name>.eta.md` for Eta. Both files can exist for the same template name at once — when they do, the Liquid template wins and the Eta file is ignored. Settings > Templates shows a language dropdown for each template so you can see and control which file is active.

## Getting started

To customize a template, go to Settings > Templates and eject the default you want to change. Ejecting copies the built-in Liquid template into your vault's template folder as a `.liquid.md` file, which you can then edit freely.

## Pages in this guide

- [Syntax](syntax.md) — Liquid syntax and ZotLit vocabulary
- [Data Reference](data-reference.md) — All `zt.*` properties
- [Frontmatter](frontmatter.md) — Expression fields, merge strategies
- [Note Import](note-import.md) — Importing Zotero child notes
- [Defaults](defaults.md) — Shipped default templates explained
- [JavaScript Templates](javascript-templates.md) — Enabling Eta and the security gate

### For advanced users migrating from Eta

- [Eta Syntax](eta/syntax.md) — Eta syntax reference
- [Migration Guide](eta/migration.md) — Migrating custom Eta templates
