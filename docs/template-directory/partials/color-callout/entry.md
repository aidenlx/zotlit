---
title: Color callout
summary: One annotation as a callout in its Zotero color, titled with the color's meaning and a link to its page, with no CSS snippet.
minAppVersion: "2.2.0-beta.0"
context: annotation
call: |
  {% include "color-meanings" -%}
  {% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
tasks: [general-reading]
features: [color-highlights, page-links, comments, images]
problems:
  - Colors don't show in my notes.
  - My callouts are always gray.
  - I need a CSS snippet before highlight colors show.
  - I want my highlights in the same colors as in Zotero.
  - My comments get mixed up with the author's words.
  - I want to jump from a highlight to its page in the PDF.
keywords:
  - callout
  - colored callouts
  - colour
  - highlight color
  - admonition
  - CSS snippet
  - calloutHeader
  - formattedAnnotations
  - zt-annot
  - annotation
  - Zotero Integration
audience: Readers who build their own profile and want each annotation to show in its Zotero color.
effort: Add this partial and the Color meanings partial to your template folder, and call both from your profile's annotation format.
---

Each annotation becomes an Obsidian callout:

- the callout's color and icon come from its callout type, which the **Color meanings** partial chooses for each Zotero color. Obsidian colors built-in callout types by itself, so the colors show with no CSS snippet and no extra plugin;
- the title is the color's meaning, then a link to the annotation's page in the PDF, such as **Important · p. 5**. When Obsidian cannot reach the PDF, the page shows as plain text;
- a highlight or underline quotes its text inside the callout, so the author's words stand apart;
- an image or ink annotation embeds its image;
- your Zotero comment follows as ordinary text in the callout, below the quoted text. A note annotation has no quoted text, so the callout holds just your comment.

The partial reads one annotation's data. It shows the callout type and title it is given, so call it after the Color meanings partial, in the annotation format of a profile, the part below `--- zotlit:annotation ---`:

```liquid
{% include "color-meanings" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
```

To use another set of meanings, include that set in place of `color-meanings`. Called without a callout type or meaning, the partial shows a blue `note` callout titled **Highlight**.
