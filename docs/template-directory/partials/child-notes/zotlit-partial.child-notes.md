---
language: liquid
---
{% if zt.notes.size > 0 -%}
## Zotero notes

{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor -%}
{% endif -%}
