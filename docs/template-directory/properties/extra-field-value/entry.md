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

The value of one line of Zotero's **Extra** field, as a property of its own. Zotero users keep data that has no field of its own in Extra, one `name: value` pair per line. This entry reads the line that starts with `cover:` and writes its value as a `cover` property.

For the sample book chapter, whose Extra field holds:

```text
original-date: 1974
cover: judgment-under-uncertainty.jpg
```

| Item | `cover` |
| --- | --- |
| Book chapter | judgment-under-uncertainty.jpg |
| Journal article, book, thesis | (no property: their Extra field has no `cover:` line) |

When the Extra field has no `cover:` line, or the line has no value, the note gets no `cover` property.

To read another line, change `"name": "cover"` at the start of the rule to the name before the colon, such as `"name": "original-date"`, and enter the same name as the **Property name**.

When the note updates: **Replace the existing value**. The property follows the Extra field on every update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `cover` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. In **Value**, replace the example rule with this entry's rule.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the name must match the Extra line exactly, with the same capital letters: `Cover:` is not `cover:`. The property holds the text of the line, not an image; an Obsidian Bases view shows it as text.
