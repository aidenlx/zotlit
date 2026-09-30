---
title: Color meanings for critical reading
summary: Highlight colors for the roles of passages in an argument, such as main claims, definitions, arguments, and objections, each shown as a callout in a matching color.
minAppVersion: "2.2.0-beta.2"
context: annotation
call: |
  {% include "color-meanings-argument" -%}
  {% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
tasks: [close-reading]
features: [color-highlights]
problems:
  - I want one highlight color for claims and another for objections.
  - I want my highlights sorted by their role in the argument.
  - I want a color code for close reading.
  - Every template I find uses different color meanings.
  - Highlights in a color I have not named get lost.
keywords:
  - color legend
  - color code
  - colour
  - colour meanings
  - critical reading
  - close reading
  - argument
  - thesis
  - claims
  - definitions
  - objections
  - critique
  - philosophy
  - law
  - colorCategory
  - Zotero Integration
audience: Readers in philosophy, law, theory, and other fields who highlight each part of an argument in its own Zotero color and want every note to say what each color means.
effort: Highlight in Zotero with the colors below, or change the meanings once to match how you already highlight.
---

The callout types match **Color meanings**: yellow shows orange, magenta shows purple, and plum shows red. The callout title keeps look-alike colors apart. Plum highlights come only from Citavi projects imported into Zotero.

To group by these meanings, add `meanings: "color-meanings-argument"` to the call of **Annotations grouped by color**.

To change a meaning or the group order, go to **Settings > ZotLit > Literature note profiles**. Under **Partials**, select **Open partial** next to `color-meanings-argument`. Change only the words in quotation marks, and use no quotation marks inside a meaning. To move a group, move its color in the `colors` line. Each note follows on its next update. To update all notes at once, run **Create or update all literature notes**.
