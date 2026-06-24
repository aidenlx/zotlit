# Template Syntax

ZotLit uses [Eta](https://eta.js.org/) as its template engine. Templates are `.eta.md` files stored in your vault's template folder (named `zotlit-<name>.eta.md`).

## Syntax

Template delimiters:

| Delimiter | Purpose |
|-----------|----------------------------------------------|
| `<% %>` | Execute JavaScript (no output) |
| `<%= %>` | Output expression (auto-filtered) |
| `<%~ %>` | Output raw (no filtering) |
| `<%/* */%>` | Comment (not rendered) |

Per-tag whitespace control is available with `-` and `_` markers:

| Marker | Effect | Example |
|--------|--------|---------|
| `-` | Trim one newline | `<%- %>`, `<% -%>` |
| `_` | Trim all whitespace | `<%_ %>`, `<% _%>` |

Place the marker on the opening side (`<%-`, `<%_`) to trim before the tag, or on the closing side (`-%>`, `_%>`) to trim after it. These override the `autoTrim` setting for that tag.

Other notes:

- **`include()` is a function call.** Write `<%~ include("name", data) %>` to include another template.
- **No `async`/`await` in templates.** ZotLit renders templates synchronously.

## Auto-filter

ZotLit enables Eta's `autoFilter` with a custom filter function: `null` and `undefined` values are silently converted to empty strings `""`. This means `<%= zt.someFieldThatIsNull %>` outputs nothing rather than the literal text `"null"` or `"undefined"`. `Temporal.Instant` values (like `zt.dateModified`) are converted to the local date string (e.g. `"2026-06-21"`). Other non-null values are coerced via their `toString()` -- this is how `<%= zt.date %>` renders ISO dates and `<%= zt.authors[0] %>` renders the creator's full name.

Because of auto-filter, `<%= %>` and `<%~ %>` behave identically for non-null string values. Use `<%~ %>` for `include()` calls (which return pre-rendered strings).

## The `zt` variable

All template data is available under the `zt` variable (changed from v1's `it`). The `zt` prefix applies across all template types:

```eta
<%= zt.title %>
<%= zt.creators[0].family %>
<%= zt.citationKey %>
```

The EtaSuggest autocomplete in the editor inserts `zt.` automatically when you type inside `<%= %>` tags.

## `include()` and data passing

Eta's `include()` function renders another template inline. In ZotLit, the data you pass to `include()` becomes the child template's `zt` variable -- it's passed directly, not merged with the parent's data.

In a parent template:

```eta
<%~ include("annotation", annotation) %>
```

The child template (`zotlit-annotation.eta.md`) receives `annotation` as its `zt` variable -- direct passthrough, not a merge.

The one special-cased include is `content`: when `zotlit-note.eta.md` includes `content`, the output is automatically wrapped with managed-region markers (see below). The marker text never appears in any `.eta.md` file.

## The `bq()` blockquote helper

For rendering Markdown blockquotes (especially Obsidian callouts) inside templates, ZotLit provides a `bq()` helper function. It captures the content block, trims it, and prefixes each line with `>`, collapsing redundant empty blockquote lines:

```eta
<% bq(() => { %>
[!note] Page <%= zt.pageLabel %>

<%= zt.text %>
<% }) %>
```

This produces:

```markdown
> [!note] Page 42
>
> The highlighted text here
```

The `bq()` helper must be used with `<% %>` (execute) tags, never inside `<%~ %>` (raw output) tags. Opening a capture inside an interpolation tag causes Eta compilation errors.

How `bq()` works:

1. Calls the callback, capturing all output produced within it.
2. Trims the captured string.
3. Splits into lines and prefixes each with `> ` (empty lines become bare `>`).
4. Collapses consecutive bare `>` lines into one.
5. Outputs the result.

## Link helpers

Every link on the `zt` context is a **function**, not a precomputed string. Call it to render the link, and pass overrides to change the display text or jump to a sub-location:

```
linkHelper(alias?, subpath?)
```

- `alias` -- the link's display text. Omit it to use the default (the filename / note title). This default matters for Markdown links: Obsidian falls back to the filename only for wikilinks, so a Markdown link with no display text renders as a bare `[](…)`. The helpers fill the text in for you, so links are never blank.
- `subpath` -- a `#`-fragment appended to the target, e.g. `"#heading"`, `"#^block"`, or `"#page=3"`.

The link helpers:

| Helper | Where | Default text | Default subpath |
|--------|-------|--------------|-----------------|
| `zt.noteLink()` | item (note, related items) | note title | none |
| `a.fileLink()` | each `zt.attachments[]` entry | attachment filename | none |
| `zt.fileLink()` | annotation | attachment filename | `#page=N` (the annotation's page) |
| `zt.imgLink()` | annotation | excerpt-image filename | none |

```eta
<%# default text, no override %>
<%= zt.attachments[0].fileLink() %>

<%# custom display text %>
<%= zt.attachments[0].fileLink("Open the PDF") %>

<%# link to a heading inside the note %>
<%= zt.noteLink("See notes", "#Summary") %>
```

`zt.fileLink()` (annotation) and `zt.imgLink()` return `""` / `null` when the file or excerpt image is unresolvable, so guard or `.filter(Boolean)` as needed. `zt.imgLink` is `null` for annotation types with no cached image (everything but `image` and `ink`).

## The `embed()` helper

`embed()` turns a link helper into a Markdown embed by prefixing `!`, and collapses cleanly to `""` when the link is absent -- so you don't have to write the `zt.imgLink ? "!" + zt.imgLink() : ""` guard yourself:

```eta
<%= embed(zt.imgLink) %>
```

It forwards `alias` / `subpath` to the underlying helper, and accepts any link helper (or `null`):

```
embed(link, alias?, subpath?)
```

- `link` is absent (`null` / `undefined`) or renders empty -> `embed` outputs `""`.
- otherwise -> `!` + the rendered link (e.g. `![[ANNOT.png]]` or `![alt](file://…)`).

## The `suffix()` filename helper

The `suffix()` helper is for the **filename template** only. It appends a short random string to keep new literature notes from overwriting existing files, but **only when the generated name actually collides** with a note already in the vault. When the name is free, it renders nothing:

```eta
<%= zt.citationKey ?? zt.title ?? zt.key %><%= suffix() %>
```

- First note named `Smith2020` -> `Smith2020.md` (no suffix).
- Second note that would render `Smith2020` -> `Smith2020_a1b2c3.md` (random string appended with an underscore separator).

### Signature

```
suffix(length = 6, prepend = "_", append = "")
```

- `length` -- number of random characters to generate. Default `6`. The string is generated with [nanoid](https://github.com/ai/nanoid) (alphanumeric only — `_` and `-` are reserved for affixes), so 6 gives ample headroom against repeat collisions.
- `prepend` -- literal text inserted **before** the random string. Default `"_"`, producing `Name_a1b2c3`.
- `append` -- literal text inserted **after** the random string. Default `""`.

The affixes appear only when the random string does -- on a collision. When the name is free, the whole thing (affixes included) renders nothing.

```eta
<%= zt.title %><%= suffix(10) %>           <%/* Title_a1b2c3d4e5 */%>
<%= zt.title %><%= suffix(6, " (", ")") %> <%/* Title (a1b2c3) */%>
<%= zt.citationKey %><%= suffix(4, "-") %> <%/* Smith2020-a1b2 */%>
```

How it works: at render time `suffix()` does not yet know whether the name collides, so it emits a placeholder marker carrying the length and affixes. After rendering, ZotLit resolves the final path:

1. Strip the marker and check whether that base name is free. If so, use it as-is -- the suffix never appears.
2. On a collision, fill the marker with `prepend` + a fresh random string + `append`, and retry, repeating a few times until a free name is found.

Notes:

- `length` must be an integer between 1 and 64, and the affixes must not contain `:` or `%`; otherwise rendering throws.
- Place `suffix()` where you want the suffix to land (typically at the end).
- The helper is meaningful only in the filename template. Used elsewhere, its marker degrades to harmless literal text rather than affecting note content.

## autoTrim

ZotLit's `autoTrim` defaults to `[false, false]` -- no trimming before or after tags. This means:

- A newline after `%>` is preserved in the output.
- Leading whitespace before `<%` is preserved.
- Template-structural blank lines appear in the rendered note.

This is intentional: Markdown is whitespace-sensitive, and silently eating newlines would break formatting. Write your templates with the exact whitespace you want in the output.

> **v1 note:** v1 defaulted to `[false, "nl"]`, which trimmed one trailing newline after each `%>`. If you're migrating a v1 template and the output has unexpected extra blank lines, this is likely why. You can use per-tag `-%>` markers or change the autoTrim setting.

Per-template autoTrim can be configured in settings as `false`, `"nl"` (trim newlines only), or `"slurp"` (trim all whitespace). The setting is a two-element array `[before, after]` controlling the behavior on each side of a tag.

## Managed region

The **managed region** is a section of the literature note that ZotLit owns and re-renders on update. It is delimited by Obsidian comments:

```markdown
%%zt-managed%%
...refreshable content...
%%/zt-managed%%
```

These markers are:

- **Invisible** in Obsidian's reading view (they are `%%` comments).
- **Not indexed** by Obsidian's metadata cache.
- **Added automatically** around the output of the `content` template -- they never appear in any `.eta.md` file.
- **Unconditional** -- emitted even when there are zero annotations, so a note created before any highlights exist stays updatable.

When you run the "Update literature note" command, ZotLit:

1. Re-renders the `content` template with fresh data.
2. Replaces the content between the markers.
3. Merges managed frontmatter keys (see [Frontmatter](frontmatter.md)).

Everything outside the managed region (your own notes, the H1 title, the backlink line) is preserved.

## Template resolution

ZotLit looks for templates in this order:

1. **Vault template folder** -- user-ejected `.eta.md` files in the configured template directory.
2. **Embedded defaults** -- built-in templates bundled with the plugin.

The vault watcher detects creates, deletes, and renames of `.eta.md` files. Modified templates are automatically detected and reloaded.

## Template names

Canonical template names and their vault files:

| Name | Vault file | Purpose |
|------|-----------|---------|
| `note` | `zotlit-note.eta.md` | Full literature note body |
| `content` | `zotlit-content.eta.md` | Managed-region content (annotations) |
| `annotation` | `zotlit-annotation.eta.md` | Single annotation rendering |
| `cite` | `zotlit-cite.eta.md` | Primary citation format |
| `cite2` | `zotlit-cite2.eta.md` | Secondary citation format |
| `filename` | _(setting string)_ | Filename for new literature notes |

The `filename` template is configured as a setting string (`template.filename`), not as a separate file. Its `zt` is limited to the item's own fields -- see [Filename template](data-reference.md#filename-template) for what is and isn't available.
