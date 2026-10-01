---
title: A value from the Extra field
summary: One line of Zotero's Extra field, such as "cover:", as its own property.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, reading-books, archival-research]
features: [properties]
problems:
  - I keep extra data in Zotero's Extra field and want it in my note.
  - I want a cover image name from Zotero as a property.
  - I want one line of the Extra field, not the whole field.
keywords:
  - Extra
  - extra field
  - cover
  - custom field
  - extra.fields
  - key value
  - original-date
audience: Readers who store their own data, such as a cover image or a reading group, in Zotero's Extra field.
effort: Add one property to your profile in the Properties tab. Change the name in the rule to the name of your Extra line.
expected:
  journal-article: {}
  book: {}
  book-section: { cover: judgment-under-uncertainty.jpg }
  thesis: {}
---

Zotero users keep data that has no field of its own in **Extra**, one `name: value` pair per line.

To read another line, change `"name": "cover"` at the start of the rule to the name before the colon, such as `"name": "reading-group"`. Enter the same name as the **Property name**.

- The name must match the line exactly, with the same capital letters: `Cover:` is not `cover:`.
- When two lines have the same name, the first line counts.
- When the line is missing or has no value, the note gets no property.
- The property holds the text of the line, not an image.

When you delete the line in Zotero, the next update removes the property.
