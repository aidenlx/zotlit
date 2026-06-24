# Default Templates

This page shows each default template in both v1 and v2, with explanations of what changed and why.

## Note template

The main template that renders the full literature note body.

### v1 (`zt-note.eta.md`)

```eta
# <%= it.title %>

[Zotero](<%= it.backlink %>) <%= it.fileLink %>
<%~ include("annots", it.annotations) %>
```

- `it.title` -- item title.
- `it.backlink` -- Zotero deep link.
- `it.fileLink` -- single attachment link (v1 selects one attachment).
- `it.annotations` -- array passed to the `annots` template.

### v2 (`zotlit-note.eta.md`)

```eta
# <%= zt.title %>

[Zotero](<%= zt.backlink %>) <%= zt.attachments.map(a => a.fileLink()).filter(Boolean).join(" ") %>

<%~ include("content", zt) %>
```

Changes:

- `it` -> `zt` prefix.
- `it.fileLink` (single attachment) -> `zt.attachments.map(a => a.fileLink())` (all attachments; `fileLink` is now a [link helper](syntax.md#link-helpers) you call).
- `it.annotations` passed to `include("annots", ...)` -> `include("content", zt)` passes the **full** context. The content template can access any `zt.*` property, not just annotations.
- The `include("content", zt)` output is automatically wrapped with `%%zt-managed%%` markers.

## Content template (was "annots")

Renders the refreshable managed region. Renamed from `zt-annots` to `zt-content`.

### v1 (`zt-annots.eta.md`)

```eta
<% for (const annotation of it) { %>
<%~ include("annotation", annotation) %>
<% } %>
```

v1 received `it` as a raw array of annotations.

### v2 (`zotlit-content.eta.md`)

```eta
<% for (const annotation of zt.annotations) { %>
<%~ include("annotation", annotation) %>
<% } %>
```

Changes:

- `it` (raw array) -> `zt.annotations` (array accessed from the full context object).
- Has access to all the same fields as the note template, so you can reference `zt.backlink`, `zt.tags`, `zt.attachments`, etc. inside the managed region.

## Annotation template

Renders a single annotation.

### v1 (`zt-annot.eta.md`)

```eta
[!note] Page <%= it.pageLabel %>

<%= it.imgEmbed %><%= it.text %>
<% if (it.comment) { %>
---
<%= it.comment %>
<% } %>
```

In v1, blockquote formatting was handled separately.

### v2 (`zotlit-annotation.eta.md`)

```eta
<% bq(() => { %>
[!note] Page <%= zt.pageLabel %>

<%= embed(zt.imgLink) %><%= zt.text %>
<% if (zt.comment) { %>

<%= zt.comment %>
<% } %>
<% }) %>
```

Changes:

- `it` -> `zt`.
- `it.imgEmbed` -> `embed(zt.imgLink)`. `zt.imgLink` is now a [link helper](syntax.md#link-helpers) (or `null` for non-image annotations); the [`embed()`](syntax.md#the-embed-helper) helper prefixes `!` for the embed and collapses to `""` when there is no image.
- `it.text` -> `zt.text` (annotation text).
- The `bq()` helper wraps the entire annotation in a blockquote, handling `>` prefixing automatically. In v1, the blockquote context was managed by the caller/framework.
- Additional properties available in v2: `zt.backlink`, `zt.parentItem`, `zt.parentAttachment`, `zt.tags`, `zt.colorHex`, `zt.colorName`, `zt.type`, `zt.dateAdded`, `zt.dateModified`.

## Citation templates

Render inline citations when inserting via the citation suggester or command.

### v1 (`zt-cite.eta.md`)

```eta
[<%= it.filter(lit => !!lit.citekey).map(lit => `@${lit.citekey}`).join("; ") %>]
```

v1 received `it` as a raw array of objects with a `citekey` property.

### v2 (`zotlit-cite.eta.md`)

```eta
[<%= zt.items.filter(c => c.citationKey).map(c => `@${c.citationKey}`).join("; ") %>]
```

Changes:

- `it` (raw array) -> `zt.items` (array inside an object). `zt` is always an object at the top level.
- `lit.citekey` -> `c.citationKey` (canonical Zotero field name; `c.citekey` also works as an alias).
- `!!lit.citekey` -> `c.citationKey` (truthiness check, same semantics).

### v1 (`zt-cite2.eta.md`)

```eta
<%= it.filter(lit => !!lit.citekey).map(lit => `@${lit.citekey}`).join("; ") %>
```

### v2 (`zotlit-cite2.eta.md`)

```eta
<%= zt.items.filter(c => c.citationKey).map(c => `@${c.citationKey}`).join("; ") %>
```

Same changes as `cite` -- object wrapper, canonical field name. The only difference from `cite` is the absence of surrounding `[]` brackets.

## Removed templates

### `zt-field`

v1's `zt-field.eta.md` rendered YAML frontmatter via template:

```eta
title: "<%= it.title %>"
citekey: "<%= it.citekey %>"
```

Replaced by the [JS expression frontmatter system](frontmatter.md). Users no longer write YAML in templates.

### `zt-colored`

v1's `zt-colored.eta.md` applied inline color styling to annotation text during Zotero note import:

```eta
<mark style="
<%- if (it.color) { _%> color: <%= it.color %>; <%_ } -%>
<%- if (it.bgColor) { _%> background-color: <%= it.bgColor %>; <%_ } -%>
"><%= it.content %></mark>
```

Color styling is now handled automatically during note import -- no template needed. The new approach:

- Works standalone (hex fallback) yet allows theme/snippet overrides via CSS variables.
- Uses semantic HTML instead of inline styles.

## Filename template

Not a file -- configured as a setting string.

### v1 default

```
<%= it.citekey ?? it.DOI ?? it.title ?? it.key %>
```

### v2 default

```
<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %><%= suffix() %>
```

Changes:

- `it` -> `zt`.
- `it.citekey` -> `zt.citationKey` (canonical name; `zt.citekey` also works).
- The `.md` extension is no longer included -- code appends it automatically.
- `<%= suffix() %>` appends a short random string **only when the generated name collides** with an existing note, keeping filenames unique without altering the common case. See [`suffix()`](syntax.md#the-suffix-filename-helper).
