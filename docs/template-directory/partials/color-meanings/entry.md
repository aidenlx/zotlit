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

Obsidian has no yellow or pink callout: yellow shows orange, magenta shows purple, and plum shows red. Plum highlights come only from Citavi projects imported into Zotero.

To change a meaning, go to **Settings > ZotLit > Literature note profiles**. Under **Partials**, select **Open partial** next to `color-meanings`. Change only the words in quotation marks: after `meaning =` for the title, or after `callout =` for the color. The file lists the callout types by color. A type Obsidian does not know shows blue with a pencil, like `note`. Use no quotation marks inside a meaning. Each note follows on its next update. To update all notes at once, run **Create or update all literature notes**.
