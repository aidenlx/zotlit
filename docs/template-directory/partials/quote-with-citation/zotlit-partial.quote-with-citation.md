---
language: liquid
---
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
