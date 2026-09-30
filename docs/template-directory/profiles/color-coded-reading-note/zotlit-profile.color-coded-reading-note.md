---
id: prKlruGBvGyi
name: Color-coded reading note
version: "1.0.0"
author: ZotLit
description: Your annotations in page order as callouts in colors that match your Zotero colors, each titled with what its color means, with the title, links back to the source, the folded abstract, and a place for your own notes.
contract: 3
minAppVersion: "2.2.0-beta.2"
sampleItemType: journalArticle
filename: '{{ zt.citekey | default: zt.title | default: zt.key | replace: "/", "-" }}{% suffix %}'
frontmatter:
  - key: title
    value: {"$if": "zt.title", "then": {"$eval": "zt.title"}}
    merge: replace
  - key: citekey
    value: {"$if": "zt.citekey", "then": {"$eval": "zt.citekey"}}
    merge: replace
  - key: tags
    value: {"$if": "len(zt.tags) > 0", "then": {"$map": {"$eval": "zt.tags"}, "each(tag)": {"$eval": "join(split(tag.name, ' '), '_')"}}}
    merge: append
  - key: year
    value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}
    merge: replace
  - key: venue
    value: {"$if": "zt.containerTitle", "then": {"$eval": "zt.containerTitle"}, "else": {"$if": "zt.publisher", "then": {"$eval": "zt.publisher"}}}
    merge: replace
  - key: status
    value: unread
    merge: keep
partials:
  - name: color-callout
    language: liquid
    source: |
      {%- if zt.pageLabel -%}
        {%- assign page = "p. " | append: zt.pageLabel -%}
        {%- capture page_link %}{{ zt | file_link: page | default: page }}{% endcapture -%}
      {%- endif -%}
      {% bq %}
      [!{{ callout | default: "note" }}] {{ meaning | default: "Highlight" }}{% if page_link %} · {{ page_link }}{% endif %}
      {% if zt.imgLink %}{{ zt.imgLink | embed }}
      {% endif %}{% if zt.text %}{% bq %}{{ zt.text }}{% endbq %}
      {% endif %}{% if zt.comment %}{% if zt.imgLink or zt.text %}

      {% endif %}{{ zt.comment }}
      {% endif %}
      {% endbq %}
  - name: color-meanings
    language: liquid
    source: |
      {%- comment -%}
      Color meanings: what each Zotero highlight color means in your notes.

      Each line below names a Zotero color, the callout type that shows it, and the
      meaning that titles the callout. Change a meaning or a callout type on its
      line, and every note that uses these meanings follows on its next update.
      Change only the words between the quotation marks.

      Built-in callout types, by the color they show without a CSS snippet:
        red: failure, danger, bug
        orange: warning, question
        green: success
        cyan: tip, important, abstract
        blue: info, note, todo
        purple: example
        gray: quote
      No built-in callout type shows yellow or pink.
      {%- endcomment -%}
      {%- case zt.colorName -%}
        {%- when "yellow" -%}  {%- assign callout = "warning" -%}  {%- assign meaning = "Important" -%}
        {%- when "red" -%}     {%- assign callout = "failure" -%}  {%- assign meaning = "Disagree" -%}
        {%- when "green" -%}   {%- assign callout = "success" -%}  {%- assign meaning = "Agree" -%}
        {%- when "blue" -%}    {%- assign callout = "info" -%}     {%- assign meaning = "Background" -%}
        {%- when "purple" -%}  {%- assign callout = "example" -%}  {%- assign meaning = "Definitions" -%}
        {%- when "magenta" -%} {%- assign callout = "example" -%}  {%- assign meaning = "Examples" -%}
        {%- when "orange" -%}  {%- assign callout = "question" -%} {%- assign meaning = "Questions" -%}
        {%- when "gray" -%}    {%- assign callout = "quote" -%}    {%- assign meaning = "Quotes to use" -%}
        {%- when "plum" -%}    {%- assign callout = "danger" -%}   {%- assign meaning = "Paraphrases" -%}
        {%- else -%}           {%- assign callout = "note" -%}     {%- assign meaning = "Other highlights" -%}
      {%- endcase -%}
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

## My notes


--- zotlit:annotation ---
{% include "color-meanings" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
