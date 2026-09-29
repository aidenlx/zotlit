---
language: liquid
---
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
