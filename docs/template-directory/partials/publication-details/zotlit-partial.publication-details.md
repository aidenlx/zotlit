---
language: liquid
---
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
