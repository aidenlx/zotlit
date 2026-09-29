---
title: Color meanings for a literature review
summary: Highlight colors for the parts of a study that a literature review compares, such as aim, methods, findings, and limitations, each shown as a callout in a matching color.
minAppVersion: "2.2.0-beta.0"
context: annotation
call: |
  {% include "color-meanings-review" -%}
  {% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
tasks: [literature-review]
features: [color-highlights]
problems:
  - I want one highlight color for methods and another for findings.
  - I want my highlights sorted by the parts of a study.
  - I want a color code for my literature review.
  - Every template I find uses different color meanings.
  - Highlights in a color I have not named get lost.
keywords:
  - color legend
  - color code
  - colour
  - colour meanings
  - literature review
  - systematic review
  - literature matrix
  - aim
  - methods
  - findings
  - limitations
  - research gap
  - colorCategory
  - Zotero Integration
audience: Literature reviewers who highlight each part of a study in its own Zotero color and want every note to say what each color means.
effort: Highlight in Zotero with the colors below, or change the meanings once to match how you already highlight.
---

When you read for a literature review, you read every study for the same things: what it asks, how it works, what it finds, and where it falls short. This set of color meanings gives each of those parts its own Zotero highlight color. It is a partial, a building block that profiles share, and the one place where the meanings live: the **Color callout** partial shows each annotation as a callout, Obsidian's colored box with an icon and a title, titled with its meaning, and the **Annotations grouped by color** partial puts the annotations of each meaning under one heading.

The meanings it starts with, in the order of their groups:

| Zotero color | Meaning | What to highlight | Color in the note |
| --- | --- | --- | --- |
| Yellow | Aim | The research question, aim, or hypothesis | Orange |
| Blue | Methods | The design, sample, data, and analysis | Blue |
| Green | Findings | The results and conclusions | Green |
| Red | Limitations | Weaknesses, caveats, and threats to validity | Red |
| Orange | Gaps and future research | What the study leaves open | Orange |
| Magenta | Related work | Earlier studies worth following up | Purple |
| Purple | Definitions | Key terms and concepts | Purple |
| Gray | Quotes to use | Sentences to quote in your review | Gray |
| Plum | Paraphrases | Passages to paraphrase | Red |
| Any other color | Other highlights | | Blue |

The callout types are the same as in **Color meanings**, so each color shows the nearest color Obsidian has, with no CSS snippet: yellow shows orange, magenta shows purple, and plum shows red. The callout title keeps colors of the same shade apart. Plum highlights come only from Citavi projects imported into Zotero. A highlight in a color that is not on the list, such as a custom color from another app, shows blue with the title **Other highlights**, so it stays in the note.

To change a meaning, open `zotlit-partial.color-meanings-review.md` in your template folder. Each color has one line, such as `{%- when "blue" -%} {%- assign callout = "info" -%} {%- assign meaning = "Methods" -%}`. Change only the words between the quotation marks: after `meaning =` to rename the color, or after `callout =` to show it in another color, with a type from the list in the file. The `colors` line at the top sets the order of the groups: to move a group, move its color in that line, and keep the commas between the colors. Every note that uses these meanings follows the next time it updates, for example when you run **Create or update all literature notes**.

The partial reads one annotation's data and writes nothing itself: it gives the annotation's callout type and meaning to the partial called after it. Use it in the annotation format of a profile, the part below `--- zotlit:annotation ---`, together with the Color callout partial:

```liquid
{% include "color-meanings-review" -%}
{% render "color-callout" with zt as zt, callout: callout, meaning: meaning -%}
```

To group the annotations by these meanings, name the set in the call of the Annotations grouped by color partial: `{% render "color-groups" with zt as zt, meanings: "color-meanings-review" -%}`.
