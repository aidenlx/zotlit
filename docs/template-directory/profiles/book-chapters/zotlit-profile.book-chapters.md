---
id: TbtUOPL31mTc
name: Book chapters
version: "1.0.0"
author: ZotLit
description: Chapter notes that name the book, its editors, and the chapter's pages, with your annotations in page order in their Zotero colors and sections for your own writing.
contract: 3
minAppVersion: "2.2.0-beta.2"
sampleItemType: bookSection
match: 'itemType == "bookSection"'
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
  - merge: replace
    value:
      {
        "$switch": {
          "zt.itemType == 'journalArticle'": {
            "journal": {"$if": "zt.containerTitle", "then": {"$eval": "zt.containerTitle"}},
            "volume": {"$if": "zt.volume", "then": {"$eval": "zt.volume"}},
            "issue": {"$if": "zt.issue", "then": {"$eval": "zt.issue"}},
            "pages": {"$if": "zt.pages", "then": {"$eval": "zt.pages"}}
          },
          "zt.itemType == 'book'": {
            "publisher": {"$if": "zt.publisher", "then": {"$eval": "zt.publisher"}},
            "place": {"$if": "zt.place", "then": {"$eval": "zt.place"}},
            "edition": {"$if": "zt.edition", "then": {"$eval": "zt.edition"}},
            "isbn": {"$if": "zt.ISBN", "then": {"$eval": "zt.ISBN"}}
          },
          "zt.itemType == 'bookSection'": {
            "$let": {"editors": {"$map": {"$eval": "zt.creators"}, "each(creator)": {"$if": "creator.role == 'editor'", "then": {"$eval": "creator.fullName"}}}},
            "in": {
              "book-title": {"$if": "zt.containerTitle", "then": {"$eval": "zt.containerTitle"}},
              "editors": {"$if": "len(editors) > 0", "then": {"$eval": "editors"}},
              "pages": {"$if": "zt.pages", "then": {"$eval": "zt.pages"}}
            }
          },
          "zt.itemType == 'thesis'": {
            "university": {"$if": "zt.publisher", "then": {"$eval": "zt.publisher"}},
            "thesis-type": {"$if": "'type' in zt && zt.type", "then": {"$eval": "zt.type"}}
          }
        }
      }
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
  - name: publication-details
    language: liquid
    source: |
      {%- comment -%}
      Publication details: one line with the details of the item's kind of source.

        Journal article: journal · Vol. · No. · pages
        Book: publisher · place · edition · ISBN
        Book chapter: the book and its editors · pages
        Thesis: thesis type · university

      A detail that Zotero has no value for is left out. Other kinds of source get
      no line. The line ends with a blank line, so the next part of the note starts
      a new paragraph.
      {%- endcomment -%}
      {%- assign parts = "" | split: "" -%}
      {%- assign pages = "" -%}
      {%- if zt.pages -%}
        {%- if zt.pages contains "-" or zt.pages contains "–" or zt.pages contains "," -%}
          {%- assign pages = "pp. " | append: zt.pages -%}
        {%- else -%}
          {%- assign pages = "p. " | append: zt.pages -%}
        {%- endif -%}
      {%- endif -%}
      {%- case zt.itemType -%}
        {%- when "journalArticle" -%}
          {%- if zt.containerTitle -%}
            {%- assign part = "*" | append: zt.containerTitle | append: "*" -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
          {%- if zt.volume -%}
            {%- assign part = "Vol. " | append: zt.volume -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
          {%- if zt.issue -%}
            {%- assign part = "No. " | append: zt.issue -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
          {%- if pages != "" -%}
            {%- assign parts = parts | push: pages -%}
          {%- endif -%}
        {%- when "book" -%}
          {%- if zt.publisher -%}
            {%- assign parts = parts | push: zt.publisher -%}
          {%- endif -%}
          {%- if zt.place -%}
            {%- assign parts = parts | push: zt.place -%}
          {%- endif -%}
          {%- if zt.edition -%}
            {%- assign part = "Edition: " | append: zt.edition -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
          {%- if zt.ISBN -%}
            {%- assign part = "ISBN " | append: zt.ISBN -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
        {%- when "bookSection" -%}
          {%- assign editors = zt.creators | where: "role", "editor" | map: "fullName" | array_to_sentence_string -%}
          {%- if zt.containerTitle -%}
            {%- assign part = "In *" | append: zt.containerTitle | append: "*" -%}
            {%- if editors != "" -%}
              {%- assign part = part | append: ", edited by " | append: editors -%}
            {%- endif -%}
            {%- assign parts = parts | push: part -%}
          {%- elsif editors != "" -%}
            {%- assign part = "Edited by " | append: editors -%}
            {%- assign parts = parts | push: part -%}
          {%- endif -%}
          {%- if pages != "" -%}
            {%- assign parts = parts | push: pages -%}
          {%- endif -%}
        {%- when "thesis" -%}
          {%- if zt.type -%}
            {%- assign parts = parts | push: zt.type -%}
          {%- endif -%}
          {%- if zt.publisher -%}
            {%- assign parts = parts | push: zt.publisher -%}
          {%- endif -%}
      {%- endcase -%}
      {%- if parts.size > 0 -%}
      {{ parts | join: " · " }}

      {% endif -%}
---
{% managed %}
# {{ zt.title }}

{% render "publication-details" with zt as zt -%}
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


## My notes


--- zotlit:annotation ---
{% include "color-meanings" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
