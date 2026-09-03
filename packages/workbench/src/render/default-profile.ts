// Built-in Profile used by standalone Workbench previews and Sample Item checks.

import { CONTRACT_VERSION } from "@zotlit/db";

export const DEFAULT_PROFILE_SOURCE = `---
id: default
name: Default
version: 1.0.0
author: ZotLit
description: The built-in Literature Note Profile.
contract: ${CONTRACT_VERSION}
filename: '{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}'
language: liquid
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
  - key: related
    expr: zt.relatedItems | note_links
    merge: replace
  - key: collections
    expr: zt.collections | collection_paths
    merge: replace
  - key: citekey
    expr: zt.citationKey
    merge: replace
---
# {{ zt.title }}

[Zotero]({{ zt.backlink }}) {{ zt.attachments | map: "fileLink" | compact | join: " " }}

{% managed %}
{% if zt.notes.size > 0 %}
## Notes

{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor %}
{% endif %}
{% if zt.annotations.size > 0 %}
## Annotations

{% for annotation in zt.annotations %}
{% render_annotation annotation %}
{% endfor %}
{% endif %}
{% endmanaged %}

--- zotlit:annotation ---
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% if zt.comment %}

{{ zt.comment }}
{% endif %}
{% endbq %}
`;
