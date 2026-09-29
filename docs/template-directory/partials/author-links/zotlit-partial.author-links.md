---
language: liquid
---
{%- for person in zt.authors %}[[{{ person.fullName }}]]{% unless forloop.last %}, {% endunless %}{% endfor -%}
