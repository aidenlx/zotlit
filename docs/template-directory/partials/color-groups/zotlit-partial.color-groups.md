---
language: liquid
---
{%- comment -%}
Annotations grouped by color: one heading for each color meaning, with the
annotations of that meaning below it in page order. A meaning with no
annotations gets no heading.

The meanings come from the Color meanings partial, or from the partial the
call names, such as meanings: "color-meanings-review". Each annotation shows
in the profile's annotation format. The groups follow the colors line of the
meanings partial; without that line, they follow Zotero's color menu:
yellow, red, green, blue, purple, magenta, orange, gray, then plum.
Annotations in any other color come last. A color with an empty meaning
shows under "Highlight", as its callout does.
{%- endcomment -%}
{%- assign meanings = meanings | default: "color-meanings" -%}
{%- include meanings, zt: nil -%}
{%- assign legend = colors | default: "yellow,red,green,blue,purple,magenta,orange,gray,plum" | remove: " " | split: "," -%}
{%- capture line_break %}
{% endcapture -%}
{%- capture found -%}
  {%- for color in legend -%}
    {%- assign first = zt.annotations | where: "colorName", color | first -%}
    {%- if first -%}{%- include meanings, zt: first -%}{{ meaning | default: "Highlight" }}{{ line_break }}{%- endif -%}
  {%- endfor -%}
  {%- for annotation in zt.annotations -%}
    {%- unless legend contains annotation.colorName -%}{%- include meanings, zt: annotation -%}{{ meaning | default: "Highlight" }}{{ line_break }}{%- endunless -%}
  {%- endfor -%}
{%- endcapture -%}
{%- assign groups = found | split: line_break | uniq -%}
{%- for group in groups %}
### {{ group }}
{% for annotation in zt.annotations -%}
  {%- include meanings, zt: annotation -%}
  {%- assign label = meaning | default: "Highlight" -%}
  {%- if label == group %}
{% render_annotation annotation -%}
  {%- endif -%}
{%- endfor -%}
{%- endfor -%}
