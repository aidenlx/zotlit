---
id: ImportPart1
name: Shared partials
version: 1.0.0
author: ZotLit Fixture
description: Fixture sample for testing Profile import with bundled Shared Partials.
contract: 3
filename: |
  {{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
citationStyle: null
importColoredHighlights: false
importAnnotationsAsTemplate: false
language: liquid
partials:
  - name: book-details
    language: liquid
    source: |
      > [!warning] Bundled book details
      > This edition differs from the vault's own zotlit-partial.book-details.md.
      > Citation key: {{ zt.citationKey | default: zt.key }}
  - name: reading-log
    language: liquid
    source: |
      > [!todo] Reading log
      > Added {{ zt.dateAdded }}
frontmatter:
  - key: title
    merge: replace
    expr: zt.title
  - key: citekey
    merge: replace
    expr: zt.citationKey
---
# {{ zt.title }}

{% managed %}
This Fixture sample brings two Shared Partials. `book-details` is the name the
vault already holds, so import asks keep or replace; `reading-log` is new, so
import writes it.

{% render "book-details" with zt as zt %}

{% render "reading-log" with zt as zt %}
{% endmanaged %}

--- zotlit:annotation ---
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% endbq %}
