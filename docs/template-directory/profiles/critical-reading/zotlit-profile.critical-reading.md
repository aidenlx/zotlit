---
id: 10kKCGI5drW6
name: Critical reading
version: "1.0.0"
author: ZotLit
description: A note for reading an argument closely, with your main thesis, key definitions, arguments, objections, and key quotes on top, and your annotations grouped by what they mark in the argument below.
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
  - name: color-groups
    language: liquid
    source: |
      {%- comment -%}
      Annotations grouped by color: one heading for each color meaning, with the
      annotations of that meaning below it in page order. A meaning with no
      annotations gets no heading.

      The meanings come from the Color meanings partial, or from the partial the
      call names, such as meanings: "color-meanings-review". Each annotation shows
      in the profile's annotation format. The groups follow the colors line of the
      meanings partial; without that line, they follow Zotero's color menu:
      yellow, red, green, blue, purple, magenta, orange, gray, then plum.
      Annotations in any other color come last. A color with an empty meaning
      shows under "Highlight", as its callout does.
      {%- endcomment -%}
      {%- assign meanings = meanings | default: "color-meanings" -%}
      {%- include meanings, zt: nil -%}
      {%- assign legend = colors | default: "yellow,red,green,blue,purple,magenta,orange,gray,plum" | remove: " " | split: "," -%}
      {%- capture line_break %}
      {% endcapture -%}
      {%- capture found -%}
        {%- for color in legend -%}
          {%- assign first = zt.annotations | where: "colorName", color | first -%}
          {%- if first -%}{%- include meanings, zt: first -%}{{ meaning | default: "Highlight" }}{{ line_break }}{%- endif -%}
        {%- endfor -%}
        {%- for annotation in zt.annotations -%}
          {%- unless legend contains annotation.colorName -%}{%- include meanings, zt: annotation -%}{{ meaning | default: "Highlight" }}{{ line_break }}{%- endunless -%}
        {%- endfor -%}
      {%- endcapture -%}
      {%- assign groups = found | split: line_break | uniq -%}
      {%- for group in groups %}
      ### {{ group }}
      {% for annotation in zt.annotations -%}
        {%- include meanings, zt: annotation -%}
        {%- assign label = meaning | default: "Highlight" -%}
        {%- if label == group %}
      {% render_annotation annotation -%}
        {%- endif -%}
      {%- endfor -%}
      {%- endfor -%}
  - name: color-meanings-argument
    language: liquid
    source: |
      {%- comment -%}
      Color meanings for critical reading: what each Zotero highlight color means
      in your notes.

      Each line below names a Zotero color, the callout type that shows it, and the
      meaning that titles the callout. Change a meaning or a callout type on its
      line, and every note that uses these meanings follows on its next update.
      Change only the words between the quotation marks, and use no quotation
      marks inside them.

      The colors line, just below this comment, sets the order of the groups in a
      note that groups annotations by color. To move a group, move its color in
      that line, and keep a comma between each two colors.

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
      {%- assign colors = "yellow,purple,green,red,orange,magenta,blue,gray,plum" -%}
      {%- case zt.colorName -%}
        {%- when "yellow" -%}  {%- assign callout = "warning" -%}  {%- assign meaning = "Main claims" -%}
        {%- when "purple" -%}  {%- assign callout = "example" -%}  {%- assign meaning = "Definitions" -%}
        {%- when "green" -%}   {%- assign callout = "success" -%}  {%- assign meaning = "Arguments" -%}
        {%- when "red" -%}     {%- assign callout = "failure" -%}  {%- assign meaning = "Objections" -%}
        {%- when "orange" -%}  {%- assign callout = "question" -%} {%- assign meaning = "Unclear points" -%}
        {%- when "magenta" -%} {%- assign callout = "example" -%}  {%- assign meaning = "Examples" -%}
        {%- when "blue" -%}    {%- assign callout = "info" -%}     {%- assign meaning = "Other views" -%}
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
# {{ zt.title }}

## Main thesis

## Key definitions

## Arguments

## Objections and doubts

## Key quotes

{% managed %}
## Source

{% render "links-row" with zt as zt -%}
{% if zt.abstract %}
{% render "folded-abstract" with zt as zt -%}
{% endif -%}
{% if zt.annotations.size > 0 %}
## Annotations
{% render "color-groups" with zt as zt, meanings: "color-meanings-argument" -%}
{% endif -%}
{% endmanaged %}

--- zotlit:annotation ---
{% include "color-meanings-argument" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
