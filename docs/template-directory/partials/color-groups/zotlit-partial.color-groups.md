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
Annotations in any other color come last.
{%- endcomment -%}
{%- assign meanings = meanings | default: "color-meanings" -%}
{%- include meanings, zt: nil -%}
{%- assign legend = colors | default: "yellow,red,green,blue,purple,magenta,orange,gray,plum" | split: "," -%}
{%- capture found -%}
  {%- for color in legend -%}
    {%- assign first = zt.annotations | where: "colorName", color | first -%}
    {%- if first -%}{%- include meanings, zt: first -%}{{ meaning }}|{%- endif -%}
  {%- endfor -%}
  {%- for annotation in zt.annotations -%}
    {%- unless legend contains annotation.colorName -%}{%- include meanings, zt: annotation -%}{{ meaning }}|{%- endunless -%}
  {%- endfor -%}
{%- endcapture -%}
{%- assign groups = found | split: "|" | uniq -%}
{%- for group in groups %}
### {{ group }}
{% for annotation in zt.annotations -%}
  {%- include meanings, zt: annotation -%}
  {%- if meaning == group %}
{% render_annotation annotation -%}
  {%- endif -%}
{%- endfor -%}
{%- endfor -%}
