---
language: liquid
---
{%- if zt.variant != "alt" -%}({%- endif -%}
{%- for cite in zt.citations -%}
{%- assign item = cite.item -%}
{%- assign names = item.creators | where: "role", item.primaryCreatorType -%}
{%- if names.size == 0 -%}{%- assign names = item.creators | where: "role", "editor" -%}{%- endif -%}
{%- if names.size == 0 -%}{%- assign names = item.creators | where: "role", "director" -%}{%- endif -%}
{%- if names.size == 0 -%}{%- assign names = item.creators | where: "role", "contributor" -%}{%- endif -%}
{%- assign name1 = names[0].literal | default: names[0].family -%}
{%- assign name2 = names[1].literal | default: names[1].family -%}
{%- if names.size > 2 -%}{%- assign author = name1 | append: " et al." -%}
{%- elsif names.size == 2 -%}{%- assign author = name1 | append: " and " | append: name2 -%}
{%- elsif names.size == 1 -%}{%- assign author = name1 -%}
{%- else -%}{%- assign author = item.shortTitle | default: item.title | default: item.citekey -%}
{%- endif -%}
{%- assign when = item.date.year | default: "n.d." -%}
{%- if cite.locator -%}{%- assign when = when | append: ", " | append: cite.labelShort | append: " " | append: cite.locator -%}{%- endif -%}
{%- if zt.variant == "alt" -%}{%- assign when = "(" | append: when | append: ")" -%}{%- endif -%}
{%- if author != "" and cite.suppressAuthor != true -%}{%- assign when = author | append: " " | append: when -%}{%- endif -%}
{%- unless forloop.first -%}; {% endunless -%}
{{- cite.prefix -}}{{- when -}}{{- cite.suffix -}}
{%- endfor -%}
{%- if zt.variant != "alt" -%}){%- endif -%}
