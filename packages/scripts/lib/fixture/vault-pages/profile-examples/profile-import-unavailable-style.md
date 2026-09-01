---
id: AbsentStyle1
name: Unavailable citation style
version: 1.0.0
author: ZotLit Fixture
description: Fixture sample for testing Profile import with an unavailable citation style.
contract: 2
filename: |
  {{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
citationStyle: https://example.invalid/styles/unavailable-citation-style
importColoredHighlights: false
importAnnotationsAsTemplate: false
language: liquid
partials:
  - name: annotation
    language: liquid
    source: |
      {% bq %}
      [!note] Page {{ zt.pageLabel }}

      {{ zt.imgLink | embed }}{{ zt.text }}
      {% if zt.comment %}

      {{ zt.comment }}
      {% endif %}
      {% endbq %}
frontmatter:
  - key: title
    merge: replace
    expr: zt.title
  - key: related
    merge: replace
    expr: zt.relatedItems | note_links
  - key: collections
    merge: replace
    expr: zt.collections | collection_paths
  - key: citekey
    merge: replace
    expr: zt.citationKey
---
# {{ zt.title }}

[Zotero]({{ zt.backlink }}) {{ zt.attachments | map: "fileLink" | compact | join: " " }}

{% managed %}
This Fixture sample invokes the unavailable citation-style fallback during Profile import.

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
{% endmanaged %}

{% annotation %}
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% if zt.comment %}

{{ zt.comment }}
{% endif %}
{% endbq %}
{% endannotation %}
