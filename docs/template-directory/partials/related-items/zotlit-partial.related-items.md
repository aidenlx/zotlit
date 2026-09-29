---
language: liquid
---
{% if zt.relatedItems.size > 0 -%}
## Related items

{% for item in zt.relatedItems -%}
{%- capture authors %}{% render "author-line" with item as zt %}{% endcapture -%}
{%- capture source %}{{ authors }}{% if authors != "" and item.date.year %}, {% endif %}{{ item.date.year }}{% endcapture -%}
- {{ item | note_link: item.title | default: item.title }}{% if source != "" %} ({{ source }}){% endif %}
{% endfor -%}
{% endif -%}
