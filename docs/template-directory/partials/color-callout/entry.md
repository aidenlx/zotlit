---
title: Color callout
summary: One annotation as a callout in the color that matches its Zotero color, titled with the color's meaning and a link to its page, with no CSS snippet.
minAppVersion: "2.2.0-beta.2"
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
  - I want my highlight colors to show in Obsidian.
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
audience: Readers who build their own profile and want each annotation to show in a color that matches its Zotero color.
effort: Add this partial and the Color meanings partial (building blocks that profiles share) to your template folder, and call both from your profile's annotation format.
---

The callout takes its type and title from the **Color meanings** partial, which the call includes just before it, so add that partial too. To use another set, such as **Color meanings for a literature review**, put its name in place of `color-meanings` in the call. Called without a type or a meaning, the callout is a blue `note` titled "Highlight".

The page number after the title links to that page of the PDF when Obsidian can reach the PDF. The examples have no PDF, so their page numbers show as plain text.

The callout colors are those of Obsidian's default theme. A theme or a CSS snippet can change them.
