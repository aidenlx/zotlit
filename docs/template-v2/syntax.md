# Syntax

ZotLit's default template language is [Liquid](https://shopify.github.io/liquid/). This page covers everything you need to write a template: Liquid's own syntax plus the handful of tags and filters ZotLit adds. Template files are named `zotlit-<name>.liquid.md` and live in your vault's template folder.

Everything a template needs is under one variable: `zt`. What's on `zt` depends on the template type — see [Data Reference](data-reference.md) for the full property list per template.

## Output and tags

Liquid has two kinds of markup:

| Syntax | Purpose |
|--------|---------|
| `{{ expression }}` | Output a value into the rendered note |
| `{% tag %}` | Run logic that doesn't itself produce output (`if`, `for`, `assign`, …) |

```liquid
{{ zt.title }}
{% if zt.comment %}
{{ zt.comment }}
{% endif %}
```

Comment out template source with `{% comment %}…{% endcomment %}` — anything inside is dropped, not rendered:

```liquid
{% comment %}
TODO: decide how to render multi-author works
{% endcomment %}
```

### Truthiness

Only `nil` (missing/`null`) and `false` are falsy in Liquid — `0`, `""`, and empty arrays are all truthy. ZotLit normalizes empty-string fields to `null` before rendering, so `{% if zt.comment %}` behaves the way you'd expect: it's false when there's no comment, true when there is one, without an extra `!= ""` check.

## Whitespace control

By default, Liquid renders whitespace exactly as written — nothing is trimmed automatically. This keeps templates portable: what you see in the template file is what lands in the note.

Add a `-` to a tag delimiter to trim on that side:

| Marker | Effect |
|--------|--------|
| `{%-` / `{{-` | Trim same-line indentation before the tag (never eats a bare blank line) |
| `-%}` / `-}}` | Trim inline blanks plus exactly one following newline |

```liquid
{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor %}
```

The trailing `-%}` on the `for` tag eats the newline right after it, so each iteration starts cleanly on `- `. A blank line placed *after* a `-%}` still survives — the marker only ever consumes one newline, not a whole blank line.

There is no vault-level whitespace setting for Liquid (unlike Eta's `autoTrim`) — trimming is explicit, per tag, which keeps templates portable across vaults.

## The `{% liquid %}` statement block

For multi-line logic, `{% liquid %}` lets you write one statement per line with no delimiters and no whitespace leakage — nothing is emitted except what you `echo` explicitly:

```liquid
{% liquid
  assign cites = "" | split: ","
  for c in zt.citations
    if c.suppressAuthor
      assign cite = "-@" | append: c.item.citationKey
    else
      assign cite = "@" | append: c.item.citationKey
    endif
    assign cites = cites | push: cite
  endfor
  echo cites | join: "; "
%}
```

Indent freely inside the block for readability — indentation is not part of the output.

## Control flow

Standard Liquid control-flow tags all work:

```liquid
{% if zt.abstract %}
> {{ zt.abstract }}
{% elsif zt.comment %}
> {{ zt.comment }}
{% else %}
> (no abstract)
{% endif %}

{% unless zt.notes.size > 0 %}
No child notes.
{% endunless %}

{% for c in zt.creators limit: 3 offset: 1 reversed %}
- {{ c.fullName }}
{% endfor %}

{% case zt.itemType %}
{% when "journalArticle" %}
Journal article
{% when "book", "bookSection" %}
Book
{% else %}
Other
{% endcase %}
```

`for` supports `limit:`, `offset:`, and `reversed` exactly as shown. Assign and capture values for reuse:

```liquid
{% assign year = zt.dateAdded | date: "%Y" %}
{% capture heading %}Notes from {{ year }}{% endcapture %}
## {{ heading }}
```

## Filters

Filters transform a value with `|` and take arguments after `:`. All the standard Liquid filters are available:

- **Arrays**: `map`, `where`, `compact`, `join`, `sort`, `first`, `last`, `size`, `push`, `uniq`, `group_by`
- **Strings**: `append`, `prepend`, `split`, `strip`, `upcase`, `downcase`, `replace`, `truncate`, `default`

```liquid
{{ zt.attachments | map: "fileLink" | compact | join: " " }}
{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}
{{ zt.title | truncate: 60 }}
```

The first example maps each attachment to its file link, drops any that came back `null` (no resolvable link), and joins the rest with a space — this is ZotLit's actual default `note` template line for linking attachments.

## ZotLit vocabulary

On top of standard Liquid, ZotLit registers a small set of tags and filters for literature-note-specific tasks.

### `{% bq %}` — blockquote block

Wraps its content in a Markdown blockquote by prefixing every line with `> `. It trims the captured content first, and collapses consecutive blank lines into a single bare `>` so you don't get a stack of empty quote lines:

```liquid
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% if zt.comment %}

{{ zt.comment }}
{% endif %}
{% endbq %}
```

renders as:

```markdown
> [!note] Page 42
>
> ![[excerpt.png]]The highlighted passage
>
> My thoughts on this
```

This is ZotLit's actual default `annotation` template — an Obsidian callout built from `{% bq %}`.

### `embed` — Markdown embed filter

`embed` prefixes a link with `!` to turn it into a Markdown/Obsidian embed, and collapses to `""` when the link is null or empty — no `{% if %}` guard needed:

```liquid
{{ zt.imgLink | embed }}
```

- Present link (`"[[excerpt.png]]"`) → `"![[excerpt.png]]"`
- Absent link (`null`) → `""`

### Link helpers

Link-producing properties on `zt` (`noteLink`, `fileLink`, `imgLink`) are functions under the hood, but Liquid auto-invokes function-valued properties on plain access — so **you don't call them**, you just reference the property and get the default rendering:

```liquid
{{ zt.noteLink }}
{{ a.fileLink }}
```

Reach for the matching filter only when you need to override the link's display text or target a sub-location:

| Filter | Overrides |
|--------|-----------|
| `{{ obj \| file_link }}` / `{{ obj \| file_link: "alias" }}` / `{{ obj \| file_link: "alias", "#subpath" }}` | attachment link |
| `{{ obj \| note_link }}` / `{{ obj \| note_link: "alias", "#heading" }}` | note link |
| `{{ obj \| img_link }}` / `{{ obj \| img_link: "alt text" }}` | excerpt-image link |

```liquid
{{ zt.attachments[0] | file_link: "Open the PDF" }}
{{ zt | note_link: "See notes", "#Summary" }}
{{ zt | img_link: "excerpt image" }}
```

A link filter/property with no resolvable target renders as `""` (or `null` inside a filter pipeline, which `compact` will drop) — it never throws.

### `{% suffix %}` — filename collision guard

`{% suffix %}` is meaningful only in the **filename** template. It renders nothing when the generated filename is free, and appends a short random string only when it would collide with a note already in the vault:

```liquid
{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
```

- First note named `Smith2020` → `Smith2020.md` (no suffix).
- A second note that would also render `Smith2020` → `Smith2020_a1b2c3.md`.

Arguments are positional — `length`, `prepend`, `append` (all optional):

```liquid
{% suffix 10 %}          {% comment %} 10-char random string, default "_" prefix {% endcomment %}
{% suffix 6, "(", ")" %} {% comment %} Title(a1b2c3) {% endcomment %}
```

### `date` — date formatting filter

`date` accepts a strftime-style format string and understands every date shape ZotLit passes it: `Temporal.Instant`, `Temporal.PlainDate`/`PlainYearMonth`, and Zotero's multipart `ItemDate`:

```liquid
{{ zt.dateAdded | date: "%Y-%m-%d" }}
{{ zt.date | date: "%Y-%m" }}
```

An `ItemDate` with `kind: "text"` (a date Zotero couldn't parse, e.g. `"submitted"`) has no real date to format — `date` renders its raw text unchanged regardless of the format string you pass.

### Utility filters

- `note_links` maps an array of items to their note links, falling back to a `zt-error:<key>` marker per item if a link can't be resolved (instead of dropping the item silently):

  ```liquid
  {{ zt.relatedItems | note_links | join: ", " }}
  ```

- `collection_paths` maps an array of collections to their joined path strings, default separator `/`:

  ```liquid
  {{ zt.collections | collection_paths }}
  {{ zt.collections | collection_paths: " > " }}
  ```

## Output coercion

Whatever a `{{ }}` expression evaluates to is coerced to text before it's written into the note:

| Value | Rendered as |
|-------|-------------|
| `null` / `undefined` | `""` (empty — never the literal text `"null"`) |
| `Temporal.Instant` | Local date string, e.g. `"2026-06-21"` |
| Creators, `ItemDate`, and other objects | Their own `toString()` (a creator's full name, an `ItemDate`'s ISO-ish text) |

This is why `{{ zt.dateAdded }}` prints a plain date and `{{ zt.creators[0] }}` prints a name, with no filter needed.

## Includes: `{% render %}`

`{% render %}` composes templates by name, passing data in as the child template's `zt`:

```liquid
{% render "content" with zt as zt %}
{% render "annotation" with annotation as zt %}
```

`with <value> as zt` binds `<value>` to `zt` inside the rendered partial. `render` gives the partial an **isolated scope** — it only sees what you explicitly pass as `zt`, not the parent template's other variables. This is standard Liquid `render` semantics: the child template file is looked up by name (e.g. `"annotation"` resolves to `zotlit-annotation.liquid.md`), not by path.

Two real defaults use this to compose:

```liquid
{% comment %} zotlit-note.liquid.md {% endcomment %}
{% render "content" with zt as zt %}
```

```liquid
{% comment %} zotlit-content.liquid.md {% endcomment %}
{% for annotation in zt.annotations %}
{% render "annotation" with annotation as zt %}
{% endfor %}
```

## Template file naming

Liquid templates are matched by filename: `zotlit-<name>.liquid.md`, stored in your vault's configured template folder. The canonical names are `note`, `content`, `annotation`, `cite`, `cite2`, and `filename` — see [Data Reference](data-reference.md) for what's available on `zt` in each.
