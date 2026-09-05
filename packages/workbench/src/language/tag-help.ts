// Liquid syntax shared by hover and completion; hosts supply localized descriptions.

const TAG_HELP = {
  assign: {
    syntax: "{% assign name = value %}",
    example: "{% assign title = zt.title | upcase %}",
  },
  capture: {
    syntax: "{% capture name %}…{% endcapture %}",
    example: "{% capture heading %}# {{ zt.title }}{% endcapture %}",
  },
  endcapture: {
    syntax: "{% endcapture %}",
    example: "{% capture heading %}# {{ zt.title }}{% endcapture %}",
  },
  for: {
    syntax:
      "{% for item in collection [limit: n] [offset: n] [reversed] %}…{% endfor %}",
    example: "{% for tag in zt.tags %}{{ tag.name }}{% endfor %}",
  },
  endfor: {
    syntax: "{% endfor %}",
    example: "{% for tag in zt.tags %}{{ tag.name }}{% endfor %}",
  },
  if: {
    syntax: "{% if condition %}…{% endif %}",
    example: "{% if zt.title != blank %}{{ zt.title }}{% endif %}",
  },
  endif: {
    syntax: "{% endif %}",
    example: "{% if zt.title != blank %}{{ zt.title }}{% endif %}",
  },
  unless: {
    syntax: "{% unless condition %}…{% endunless %}",
    example:
      "{% unless zt.tags == empty %}Tags: {{ zt.tags | map: 'name' | join: ', ' }}{% endunless %}",
  },
  endunless: {
    syntax: "{% endunless %}",
    example: "{% unless zt.title == blank %}{{ zt.title }}{% endunless %}",
  },
  else: {
    syntax: "{% else %}",
    example:
      "{% if zt.title != blank %}{{ zt.title }}{% else %}Untitled{% endif %}",
  },
  elsif: {
    syntax: "{% elsif condition %}",
    example:
      "{% if zt.title != blank %}{{ zt.title }}{% elsif zt.key %}{{ zt.key }}{% endif %}",
  },
  case: {
    syntax: "{% case value %}{% when value %}…{% endcase %}",
    example:
      "{% case zt.colorName %}{% when 'yellow' %}Highlight{% else %}Note{% endcase %}",
  },
  when: {
    syntax: "{% when value [or value] %}",
    example:
      "{% case zt.colorName %}{% when 'yellow' or 'green' %}Highlight{% endcase %}",
  },
  endcase: {
    syntax: "{% endcase %}",
    example: "{% case zt.colorName %}{% when 'yellow' %}Highlight{% endcase %}",
  },
  break: {
    syntax: "{% break %}",
    example: "{% for tag in zt.tags %}{{ tag.name }}{% break %}{% endfor %}",
  },
  continue: {
    syntax: "{% continue %}",
    example:
      "{% for tag in zt.tags %}{% if tag.name == 'hidden' %}{% continue %}{% endif %}{{ tag.name }}{% endfor %}",
  },
  cycle: {
    syntax: "{% cycle [group:] value, value %}",
    example:
      "{% for tag in zt.tags %}{% cycle '-', '*' %} {{ tag.name }}{% endfor %}",
  },
  increment: {
    syntax: "{% increment name %}",
    example: "{% increment index %} {% increment index %}",
  },
  decrement: {
    syntax: "{% decrement name %}",
    example: "{% decrement index %} {% decrement index %}",
  },
  echo: {
    syntax: "{% echo value [| filter] %}",
    example: "{% echo zt.title | upcase %}",
  },
  render: {
    syntax: "{% render 'partial' [with value as name] [name: value] %}",
    example: "{% render 'annotation' with annotation as zt %}",
  },
  include: {
    syntax: "{% include 'partial' [name: value] %}",
    example: "{% include 'cite', zt: zt %}",
  },
  layout: {
    syntax: "{% layout 'partial' %}",
    example:
      "{% layout 'note' %}{% block content %}{{ zt.title }}{% endblock %}",
  },
  block: {
    syntax: "{% block [name] %}…{% endblock %}",
    example: "{% block content %}{{ zt.title }}{% endblock %}",
  },
  endblock: {
    syntax: "{% endblock %}",
    example: "{% block content %}{{ zt.title }}{% endblock %}",
  },
  tablerow: {
    syntax:
      "{% tablerow item in collection [cols: n] [limit: n] [offset: n] %}…{% endtablerow %}",
    example:
      "<table>{% tablerow tag in zt.tags cols: 2 %}{{ tag.name }}{% endtablerow %}</table>",
  },
  endtablerow: {
    syntax: "{% endtablerow %}",
    example:
      "<table>{% tablerow tag in zt.tags cols: 2 %}{{ tag.name }}{% endtablerow %}</table>",
  },
  raw: {
    syntax: "{% raw %}…{% endraw %}",
    example: "{% raw %}{{ zt.title }}{% endraw %}",
  },
  endraw: {
    syntax: "{% endraw %}",
    example: "{% raw %}{{ zt.title }}{% endraw %}",
  },
  comment: {
    syntax: "{% comment %}…{% endcomment %}",
    example: "{% comment %}{{ zt.title }}{% endcomment %}",
  },
  endcomment: {
    syntax: "{% endcomment %}",
    example: "{% comment %}{{ zt.title }}{% endcomment %}",
  },
  "#": {
    syntax: "{% # … %}",
    example: "{% # {{ zt.title }} %}",
  },
  liquid: {
    syntax: "{% liquid\n  tag arguments\n%}",
    example: "{% liquid\n  assign title = zt.title | upcase\n  echo title\n%}",
  },
  bq: {
    syntax: "{% bq %}…{% endbq %}",
    example: "{% bq %}{{ zt.text }}{% endbq %}",
  },
  endbq: {
    syntax: "{% endbq %}",
    example: "{% bq %}{{ zt.text }}{% endbq %}",
  },
  suffix: {
    syntax: "{% suffix [length, prepend, append] %}",
    example: "{{ zt.title }}{% suffix 6, '_', '' %}",
  },
  render_annotation: {
    syntax: "{% render_annotation annotation %}",
    example:
      "{% for annotation in zt.annotations %}{% render_annotation annotation %}{% endfor %}",
  },
  managed: {
    syntax: "{% managed %}…{% endmanaged %}",
    example: "{% managed %}\n{{ zt.title }}\n{% endmanaged %}",
  },
  endmanaged: {
    syntax: "{% endmanaged %}",
    example: "{% managed %}\n{{ zt.title }}\n{% endmanaged %}",
  },
};

export type LiquidTagName = keyof typeof TAG_HELP;
export const DOCUMENTED_TAG_NAMES: readonly string[] = Object.keys(TAG_HELP);

/** Syntax and an example for a supported Liquid tag. */
export function tagHelp(
  name: string,
  description?: (name: LiquidTagName) => string,
) {
  return Object.hasOwn(TAG_HELP, name)
    ? {
        ...TAG_HELP[name as LiquidTagName],
        detail:
          description?.(name as LiquidTagName) ??
          TAG_HELP[name as LiquidTagName].syntax,
      }
    : undefined;
}
