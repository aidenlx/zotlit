---
language: liquid
---
{%- assign people = zt.authors -%}
{%- capture first %}{{ people[0].literal | default: people[0].family | default: people[0].fullName }}{% endcapture -%}
{%- capture second %}{{ people[1].literal | default: people[1].family | default: people[1].fullName }}{% endcapture -%}
{%- if people.size == 1 %}{{ first }}{% elsif people.size == 2 %}{{ first }} & {{ second }}{% elsif people.size > 2 %}{{ first }} et al.{% endif -%}
