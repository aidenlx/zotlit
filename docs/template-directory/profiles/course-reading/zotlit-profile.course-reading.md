---
id: k3v00qmtPRE7
name: Course reading
version: "1.0.0"
author: ZotLit
description: Notes for the readings of a course, with course and week properties you fill in, a reading status, your annotations in page order, and places for a summary, key points, and discussion questions.
contract: 3
minAppVersion: "2.2.0-beta.2"
sampleItemType: journalArticle
filename: '{{ zt.citekey | default: zt.title | default: zt.key | replace: "/", "-" }}{% suffix %}'
frontmatter:
  - key: title
    value: {"$if": "zt.title", "then": {"$eval": "zt.title"}}
    merge: replace
  - key: authors
    value: {"$if": "len(zt.authors) > 0", "then": {"$map": {"$eval": "zt.authors"}, "each(author)": {"$eval": "author.fullName"}}}
    merge: replace
  - key: year
    value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}
    merge: replace
  - key: venue
    value: {"$if": "zt.containerTitle", "then": {"$eval": "zt.containerTitle"}, "else": {"$if": "zt.publisher", "then": {"$eval": "zt.publisher"}}}
    merge: replace
  - key: citekey
    value: {"$if": "zt.citekey", "then": {"$eval": "zt.citekey"}}
    merge: replace
  - key: tags
    value: {"$if": "len(zt.tags) > 0", "then": {"$map": {"$eval": "zt.tags"}, "each(tag)": {"$eval": "join(split(tag.name, ' '), '_')"}}}
    merge: append
  - key: course
    value: null
    merge: keep
  - key: week
    value: null
    merge: keep
  - key: status
    value: unread
    merge: keep
partials:
  - name: folded-abstract
    language: liquid
    source: |
      {% if zt.abstract -%}
      {% bq %}
      [!abstract]- Abstract
      {{ zt.abstract }}
      {% endbq %}
      {% endif -%}
  - name: links-row
    language: liquid
    source: |
      {%- assign pdf_link = "" -%}
      {%- for attachment in zt.attachments -%}
        {%- if pdf_link == "" and attachment.contentType == "application/pdf" -%}
          {%- capture pdf_link %}{{ attachment | file_link: "PDF" }}{% endcapture -%}
        {%- endif -%}
      {%- endfor -%}
      [Zotero]({{ zt.backlink }}){% if pdf_link != "" %} · {{ pdf_link }}{% endif %}{% if zt.DOI %} · [DOI](https://doi.org/{{ zt.DOI }}){% endif %}{% if zt.url %} · [Web page]({{ zt.url }}){% endif %}
  - name: plain-annotation-quote
    language: liquid
    source: |
      {%- if zt.pageLabel -%}
        {%- assign page = "p. " | append: zt.pageLabel -%}
        {%- capture page_link %}({{ zt | file_link: page | default: page }}){% endcapture -%}
      {%- endif -%}
      {%- if zt.imgLink or zt.text -%}
      {% bq %}
      {% if zt.imgLink %}{{ zt.imgLink | embed }}
      {% endif %}{{ zt.text }}{% if zt.text and page_link %} {% endif %}{{ page_link }}
      {% endbq %}
      {% if zt.comment %}
      {{ zt.comment }}
      {% endif -%}
      {%- elsif zt.comment -%}
      {{ zt.comment }}{% if page_link %} {{ page_link }}{% endif %}
      {% endif -%}
---
{% managed %}
# {{ zt.title }}

{% render "links-row" with zt as zt -%}
{% if zt.abstract %}
{% render "folded-abstract" with zt as zt -%}
{% endif -%}
{% if zt.annotations.size > 0 %}
## Annotations
{% for annotation in zt.annotations %}
{% render_annotation annotation -%}
{% endfor -%}
{% endif -%}
{% endmanaged %}

## Summary


## Key points


## Discussion questions


--- zotlit:annotation ---
{% render "plain-annotation-quote" with zt as zt -%}
