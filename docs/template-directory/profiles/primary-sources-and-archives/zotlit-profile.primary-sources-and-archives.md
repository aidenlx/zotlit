---
id: s9jSo43mQJ5E
name: Primary sources and archives
version: "1.0.0"
author: ZotLit
description: Source notes for letters, manuscripts, interviews, documents, and newspaper articles, with the archive, the archive location, the date, and the place, each quote followed by its citation, and places for context, content, and connections.
contract: 3
minAppVersion: "2.2.0-beta.2"
sampleItemType: letter
match:
  or:
    - 'itemType == "letter"'
    - 'itemType == "manuscript"'
    - 'itemType == "interview"'
    - 'itemType == "document"'
    - 'itemType == "newspaperArticle"'
filename: '{{ zt.citekey | default: zt.title | default: zt.key | replace: "/", "-" }}{% suffix %}'
frontmatter:
  - key: title
    value: {"$if": "zt.title", "then": {"$eval": "zt.title"}}
    merge: replace
  - key: authors
    value: {"$if": "len(zt.authors) > 0", "then": {"$map": {"$eval": "zt.authors"}, "each(author)": {"$eval": "author.fullName"}}}
    merge: replace
  - key: date
    value: {"$if": "zt.date && zt.date.kind == 'date'", "then": {"$eval": "zt.date.value"}}
    merge: replace
  - key: year
    value: {"$if": "zt.date && zt.date.year", "then": {"$eval": "zt.date.year"}}
    merge: replace
  - key: item-type
    merge: replace
    value:
      {
        "$let": {
          "names": {
            "artwork": "Artwork",
            "audioRecording": "Audio Recording",
            "bill": "Bill",
            "blogPost": "Blog Post",
            "book": "Book",
            "bookSection": "Book Section",
            "case": "Case",
            "computerProgram": "Software",
            "conferencePaper": "Conference Paper",
            "dataset": "Dataset",
            "dictionaryEntry": "Dictionary Entry",
            "document": "Document",
            "email": "E-mail",
            "encyclopediaArticle": "Encyclopedia Article",
            "film": "Film",
            "forumPost": "Forum Post",
            "hearing": "Hearing",
            "instantMessage": "Instant Message",
            "interview": "Interview",
            "journalArticle": "Journal Article",
            "letter": "Letter",
            "magazineArticle": "Magazine Article",
            "manuscript": "Manuscript",
            "map": "Map",
            "newspaperArticle": "Newspaper Article",
            "patent": "Patent",
            "podcast": "Podcast",
            "preprint": "Preprint",
            "presentation": "Presentation",
            "radioBroadcast": "Radio Broadcast",
            "report": "Report",
            "standard": "Standard",
            "statute": "Statute",
            "thesis": "Thesis",
            "tvBroadcast": "TV Broadcast",
            "videoRecording": "Video Recording",
            "webpage": "Web Page"
          }
        },
        "in": {"$if": "zt.itemType in names", "then": {"$eval": "names[zt.itemType]"}, "else": {"$eval": "zt.itemType"}}
      }
  - key: venue
    value: {"$if": "zt.containerTitle", "then": {"$eval": "zt.containerTitle"}, "else": {"$if": "zt.publisher", "then": {"$eval": "zt.publisher"}}}
    merge: replace
  - key: archive
    value: {"$if": "'archive' in zt && zt.archive", "then": {"$eval": "zt.archive"}}
    merge: replace
  - key: archive-location
    value: {"$if": "'archiveLocation' in zt && zt.archiveLocation", "then": {"$eval": "zt.archiveLocation"}}
    merge: replace
  - key: place
    value: {"$if": "zt.place", "then": {"$eval": "zt.place"}, "else": {"$if": "'eventPlace' in zt && zt.eventPlace", "then": {"$eval": "zt.eventPlace"}}}
    merge: replace
  - key: citekey
    value: {"$if": "zt.citekey", "then": {"$eval": "zt.citekey"}}
    merge: replace
  - key: tags
    value: {"$if": "len(zt.tags) > 0", "then": {"$map": {"$eval": "zt.tags"}, "each(tag)": {"$eval": "join(split(tag.name, ' '), '_')"}}}
    merge: append
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
  - name: quote-with-citation
    language: liquid
    source: |
      {%- if zt.citation -%}
        {%- assign source = zt.citation -%}
      {%- elsif zt.parentItem.citekey -%}
        {%- capture source %}[@{{ zt.parentItem.citekey }}{% if zt.pageLabel %}, {p. {{ zt.pageLabel }}}{% endif %}]{% endcapture -%}
      {%- elsif zt.pageLabel -%}
        {%- assign page = "p. " | append: zt.pageLabel -%}
        {%- capture source %}({{ zt | file_link: page | default: page }}){% endcapture -%}
      {%- endif -%}
      {%- if zt.imgLink or zt.text -%}
      {% bq %}
      {% if zt.imgLink %}{{ zt.imgLink | embed }}
      {% endif %}{{ zt.text }}{% if zt.text and source %} {% endif %}{{ source }}
      {% endbq %}
      {% if zt.comment %}
      {{ zt.comment }}
      {% endif -%}
      {%- elsif zt.comment -%}
      {{ zt.comment }}{% if source %} {{ source }}{% endif %}
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

## Context


## Content


## Connections


--- zotlit:annotation ---
{% render "quote-with-citation" with zt as zt -%}
