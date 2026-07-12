# Default Templates

ZotLit ships with Liquid defaults for every template type. These are embedded in the plugin and used when no user-ejected file exists. To customize, eject a template via Settings > Templates, then edit the resulting `.liquid.md` file.

## Note template

File: `zotlit-note.liquid.md`

```liquid
# {{ zt.title }}

[Zotero]({{ zt.backlink }}) {{ zt.attachments | map: "fileLink" | compact | join: " " }}

{% render "content" with zt as zt %}
```

- Renders the item title as an H1.
- Links to the Zotero item (deep link) and every resolvable attachment file. `map: "fileLink"` calls `fileLink` on each attachment; `compact` drops attachments that don't resolve to a link.
- Includes the `content` template, passing the full `zt` context so it can reach notes, annotations, and any other item property.

## Content template

File: `zotlit-content.liquid.md`

```liquid
{% if zt.notes.size > 0 %}
## Notes

{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor %}
{% endif %}
{% if zt.annotations.size > 0 %}
## Annotations

{% for annotation in zt.annotations %}
{% render "annotation" with annotation as zt %}
{% endfor %}
{% endif %}
```

- Renders a "Notes" section listing linked child notes. Referencing `note.noteLink` imports each note as a standalone Markdown file (see [Note Import](note-import.md)).
- Renders an "Annotations" section, including each annotation via the `annotation` template.
- Both sections only appear when they have content (`zt.notes.size > 0` / `zt.annotations.size > 0`).
- This is the output that gets wrapped in the managed-region markers, so "Update literature note" re-renders it while leaving the rest of the note body untouched.

## Annotation template

File: `zotlit-annotation.liquid.md`

```liquid
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% if zt.comment %}

{{ zt.comment }}
{% endif %}
{% endbq %}
```

- Wraps the entire annotation in a callout blockquote via the `{% bq %}` / `{% endbq %}` block tag.
- Shows the page label in the callout title.
- Embeds the excerpt image before the text -- the `embed` filter prefixes `!` for the embed syntax and collapses to `""` when `zt.imgLink` is `null` (non-image annotations).
- Appends the user comment when present.

## Citation templates

Files: `zotlit-cite.liquid.md` / `zotlit-cite2.liquid.md`

```liquid
[{% liquid
  assign cites = "" | split: ","
  for c in zt.citations
    if c.item.citationKey
      if c.suppressAuthor
        assign cite = "-@" | append: c.item.citationKey
      else
        assign cite = "@" | append: c.item.citationKey
      endif
      if c.locator
        assign cite = cite | append: ", " | append: c.labelShort | append: " " | append: c.locator
      endif
      assign cites = cites | push: cite
    endif
  endfor
  echo cites | join: "; "
%}]
```

- Builds Pandoc-style citations, e.g. `[@smith2024, p. 62; -@doe2021]`.
- Filters out citation items without a `citationKey` -- those never appear in the output.
- Handles suppress-author citations (`-@key` instead of `@key`) and locators (`, p. 62` appended after the key, using `labelShort` for the locator label).
- `cite` wraps the joined citations in `[]`; `cite2` is identical but omits the brackets, for inserting a citation inline within existing text.

## Filename template

File: `zotlit-filename.liquid.md`

```liquid
{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
```

- Falls through in order: citation key -> DOI -> title -> item key, using `default` to skip blank values.
- `{% suffix %}` appends a short random string, but only when the generated name collides with an existing note -- it keeps filenames unique without altering the common case.
- The `.md` extension is appended automatically; the filename template only produces the base name.
