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

When you read an argument closely, you mark what the author claims, how the author defines the terms, which reasons support the claims, and where you have doubts. This set of color meanings gives each of those roles its own Zotero highlight color. It is a partial, a building block that profiles share, and the one place where the meanings live: the **Color callout** partial shows each annotation as a callout, Obsidian's colored box with an icon and a title, titled with its meaning, and the **Annotations grouped by color** partial puts the annotations of each meaning under one heading.

The meanings it starts with, in the order of their groups:

| Zotero color | Meaning | What to highlight | Color in the note |
| --- | --- | --- | --- |
| Yellow | Main claims | The claims the author sets out to defend | Orange |
| Purple | Definitions | How the author defines key terms | Purple |
| Green | Arguments | Reasons and evidence for the claims | Green |
| Red | Objections | Passages you doubt or disagree with | Red |
| Orange | Unclear points | Passages you do not follow yet | Orange |
| Magenta | Examples | Cases and examples | Purple |
| Blue | Other views | Positions of others that the author takes up | Blue |
| Gray | Quotes to use | Sentences to quote in your own writing | Gray |
| Plum (from Citavi only) | Paraphrases | Passages to paraphrase | Red |
| Any other color | Other highlights | | Blue |

The callout types are the same as in **Color meanings**, so each color shows the nearest color Obsidian has, with no CSS snippet: yellow shows orange, magenta shows purple, and plum shows red. So yellow and orange highlights share a color, as do purple and magenta, red and plum, and blue and any color not on the list; the callout title keeps them apart. Plum highlights come only from Citavi projects imported into Zotero. A highlight in a color that is not on the list, such as a custom color from another app, shows blue with the title **Other highlights**, so it stays in the note.

To change a meaning, open `zotlit-partial.color-meanings-argument.md` in your template folder. Each color has one line, such as `{%- when "red" -%} {%- assign callout = "failure" -%} {%- assign meaning = "Objections" -%}`. Change only the words between the quotation marks: after `meaning =` to rename the color, or after `callout =` to show it in another color, with a type from the list in the file. Use no quotation marks inside a meaning. The `colors` line, just below the comment at the top of the file, sets the order of the groups: to move a group, move its color in that line, and keep a comma between each two colors. Every note that uses these meanings follows the next time it updates, for example when you run **Create or update all literature notes**.

The partial reads one annotation's data and writes nothing itself: it gives the annotation's callout type and meaning to the partial called after it. Use it in the annotation format of a profile, the part below `--- zotlit:annotation ---`, together with the Color callout partial:

```liquid
{% include "color-meanings-argument" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
```

To group the annotations by these meanings, keep this set in the annotation format and name it in the call of the Annotations grouped by color partial too: `{% render "color-groups" with zt as zt, meanings: "color-meanings-argument" -%}`.
