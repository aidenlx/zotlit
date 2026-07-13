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

ZotLit v1 used Eta (a JavaScript-based engine) as its only template language. v2 switches the default to Liquid because Liquid templates can only combine data into text — they cannot read arbitrary files, make network requests, or run OS commands. That makes them safe to share, sync across devices, and install from community sources without trusting arbitrary code.

For advanced use cases, ZotLit still supports Eta ("JavaScript Templates"), which lets templates run arbitrary JavaScript expressions. Because that carries a larger security surface, Eta is off by default and must be turned on per device via the JavaScript templates setting. See [JavaScript Templates](javascript-templates.md) for how to enable it and what it protects against.

Templates are matched by filename: `zotlit-<name>.liquid.md` for Liquid, `zotlit-<name>.eta.md` for Eta. Both files can exist for the same template name at once — when they do, the Liquid template wins and the Eta file is ignored. Settings > Templates shows a language dropdown for each template so you can see and control which file is active.

## Getting started

To customize a template, go to Settings > Templates and eject the default you want to change. Ejecting copies the built-in Liquid template into your vault's template folder as a `.liquid.md` file, which you can then edit freely.

## Template Data Explorer

The **Template Data Explorer** is a sidebar view that shows the exact `zt` data a template receives for any real item from your Zotero library. Use it to discover field names, check values, and copy paste-ready template paths — no guessing from documentation required.

### Opening the explorer

| From | How |
|------|-----|
| Command palette | Run **Open template data explorer**. If a literature note is active, the explorer seeds from that note's item automatically. |
| Literature note menu | Open the note's `⋮` menu and choose **Explore template data**. |
| Annotation sidebar | Click the explore action on any annotation row to open the explorer for that annotation's item. |
| Zotero item | Right-click an item in Zotero and choose the ZotLit explore entry. |
| Zotero reader | Right-click an annotation in Zotero's PDF reader and choose the ZotLit explore entry — the explorer opens anchored at that annotation. |

The explorer opens in the right sidebar. Once open, use the item picker at the top to switch to any item in your library.

### Using the explorer

- **Browse** the tree to see every `zt.*` property and its current value for the selected item.
- **Copy path**: each node's menu offers a paste-ready Liquid path (e.g. `zt.annotations[0].comment`). With [JavaScript Templates](javascript-templates.md) enabled, an Eta path variant (`it.…`) is also listed.
- **Copy value**: the copy button on each row copies the node's current value (primitives verbatim, objects/arrays as JSON).
- **Filter**: type in the filter box to match key names or values by case-insensitive substring — matching nodes appear with their ancestor chain auto-expanded.

### Note Root and Annotation Root

The explorer defaults to the **Note Root** — the full `zt` object that `note` and `content` templates receive. To see the shape your `annotation` template receives, click the explore action on any annotation node to re-anchor the tree at that annotation. Copy paths adjust to the annotation root automatically (e.g. `zt.comment` instead of `zt.annotations[3].comment`). A breadcrumb at the top navigates back to the Note Root.

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
