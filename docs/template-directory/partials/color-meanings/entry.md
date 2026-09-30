---
title: Color meanings
summary: The one place where you name what each Zotero highlight color means and which callout type shows it in the note.
minAppVersion: "2.2.0-beta.2"
context: annotation
call: |
  {% include "color-meanings" -%}
  {% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
tasks: [general-reading]
features: [color-highlights]
problems:
  - I want to set what each highlight color means once, in one place.
  - My highlight colors mean something, and I want my notes to say what.
  - Colors don't show in my notes.
  - The callout colors do not match my Zotero colors.
  - Every template I find uses different color meanings.
  - Highlights in a color I have not named get lost.
keywords:
  - color legend
  - color code
  - colour
  - colour meanings
  - highlight colors
  - callout type
  - colorCategory
  - colorName
  - colorValueToName
  - Zotero Integration
audience: Readers who highlight in Zotero with one color for each kind of passage and want every note to say what each color means.
effort: Read the list of meanings once and change the ones that do not match how you highlight. The meanings work as they are.
---

Your highlight colors mean something only to you: one reader marks definitions in purple, another marks questions. This partial, a building block that profiles share, is the one place where you write down what each Zotero color means. The **Color callout** partial then shows each annotation as a callout, Obsidian's colored box with an icon and a title, in a matching color and titled with its meaning. The colors show with no CSS snippet and no extra plugin, because each meaning uses a callout type that Obsidian colors by itself.

The meanings it starts with:

| Zotero color | Meaning | Callout type | Color in the note |
| --- | --- | --- | --- |
| Yellow | Important | `warning` | Orange |
| Red | Disagree | `failure` | Red |
| Green | Agree | `success` | Green |
| Blue | Background | `info` | Blue |
| Purple | Definitions | `example` | Purple |
| Magenta | Examples | `example` | Purple |
| Orange | Questions | `question` | Orange |
| Gray | Quotes to use | `quote` | Gray |
| Plum | Paraphrases | `danger` | Red |
| Any other color | Other highlights | `note` | Blue |

Obsidian has no yellow or pink callout, so each Zotero color uses the nearest color Obsidian has: yellow shows orange, magenta shows purple, and plum shows red. So yellow and orange highlights share a color, as do purple and magenta, red and plum, and blue and any color not on the list; the callout title keeps them apart. Plum highlights come only from Citavi projects imported into Zotero, where plum marks a paraphrase. A highlight in a color that is not on the list, such as a custom color from another app, shows blue with the title **Other highlights**, so it stays in the note.

To change a meaning, open `zotlit-partial.color-meanings.md` in your template folder. Each color has one line, such as `{%- when "yellow" -%} {%- assign callout = "warning" -%} {%- assign meaning = "Important" -%}`. Change only the words between the quotation marks: after `meaning =` to rename the color, or after `callout =` to show it in another color, with a type from the table below. Every note that uses these meanings follows the next time it updates, for example when you run **Create or update all literature notes**.

Callout types by the color they show in Obsidian's default theme. The icon comes with the type:

| Color | Callout type and icon |
| --- | --- |
| Red | `failure` (cross), `danger` (lightning bolt), `bug` (bug) |
| Orange | `warning` (warning sign), `question` (question mark) |
| Green | `success` (check mark) |
| Cyan (blue-green) | `tip` (flame), `important` (flame), `abstract` (clipboard) |
| Blue | `info` (letter i), `note` (pencil), `todo` (check circle) |
| Purple | `example` (list) |
| Gray | `quote` (quotation mark) |

A type Obsidian does not know shows blue with a pencil, like `note`. A theme or a CSS snippet can change these colors.

The partial reads one annotation's data and writes nothing itself: it gives the annotation's callout type and meaning to the partial called after it. Use it in the annotation format of a profile, the part below `--- zotlit:annotation ---`, together with the Color callout partial:

```liquid
{% include "color-meanings" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
```
