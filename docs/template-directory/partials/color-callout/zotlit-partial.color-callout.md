---
language: liquid
---
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
