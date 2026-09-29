---
language: liquid
---
{%- assign comment = zt.comment | default: "" -%}
{%- assign marker = comment | slice: 0, 4 | downcase -%}
{%- assign next = comment | slice: 4 -%}
{%- assign task = "" -%}
{%- if marker == "todo" -%}
  {%- if next == " " or next == ":" -%}
    {%- assign task = comment | slice: 5, comment.size | lstrip -%}
  {%- endif -%}
{%- endif -%}
{%- if task != "" %}- [ ] {{ task }}{% else %}{{ comment }}{% endif -%}
