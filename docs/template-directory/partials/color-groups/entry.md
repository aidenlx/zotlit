---
title: Annotations grouped by color
summary: Your annotations under one heading for each color meaning, such as Definitions or Questions, in a fixed order, with no heading for a meaning you did not use.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading, literature-review, close-reading]
features: [grouped-by-color]
problems:
  - I want my highlights grouped by color.
  - I want all my definitions, or all my questions, in one place.
  - I want a heading for each highlight color.
  - Empty color headings clutter my notes.
  - My images and sticky notes disappear when I group by color.
  - The color sections come in a random order.
keywords:
  - group by color
  - grouped by colour
  - colour sections
  - heading per color
  - color headings
  - highlight color
  - colorCategory
  - groupby
  - Zotero Integration
audience: Readers who build their own profile and want their annotations sorted under a heading for each color meaning.
effort: Add this partial and a color meanings partial (building blocks that profiles share) to your template folder, and call this one from your profile's note format.
---

The partial writes your annotations in groups: one heading for each color meaning, such as `### Definitions`, and below it every annotation of that meaning, in page order. A meaning you did not use in this source gets no heading, so the note holds only the groups it needs.

- **Which meanings.** The partial reads the meaning of each color from a color meanings partial: **Color meanings** unless you name another set in the call. Two colors with the same meaning share one group.
- **Which order.** The groups follow the order of the colors in Zotero's color menu: yellow, red, green, blue, purple, magenta, orange, and gray, then plum. A meaning set can give its own order in a `colors` line, as **Color meanings for a literature review** and **Color meanings for critical reading** do.
- **Other colors.** Annotations in a color the meanings do not list, such as a custom color from another app, come last, under the fallback title of the meaning set, such as **Other highlights**.
- **Every kind of annotation.** Highlights, underlines, notes, text boxes, images, and ink drawings all go into the group of their color, so nothing is left out.

Each annotation shows in your profile's annotation format, the part below `--- zotlit:annotation ---`. For colored callouts, use the **Color callout** partial there, with the same meaning set.

The partial reads the item's data. Call it in the note format of a profile, below a heading of your own, inside `{% managed %}` … `{% endmanaged %}`:

```liquid
{% if zt.annotations.size > 0 %}
## Annotations
{% render "color-groups" with zt as zt -%}
{% endif -%}
```

To group by another meaning set, name it in the call, and include the same set in the annotation format:

```liquid
{% render "color-groups" with zt as zt, meanings: "color-meanings-review" -%}
```

The group headings are level three (`###`), to sit under a level-two heading such as **Annotations**.
