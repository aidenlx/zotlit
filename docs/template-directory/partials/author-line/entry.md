---
title: Author line
summary: The authors in one short line, such as "Smith", "Smith & Lee", or "Smith et al.".
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading, writing]
problems:
  - I want "et al." when a paper has three or more authors.
  - The full author list is too long for the top of my note.
  - I want "and" or "等" instead of "&" or "et al.".
keywords:
  - authors
  - author list
  - et al.
  - authorsShort
  - first author
  - creators
  - byline
audience: Readers who build their own profile and want a short author line, the way a citation names the authors.
effort: Add the partial to your template folder and call it from your profile's note body.
---

The authors of the item, by family name, in one short line:

- one author: "Smith";
- two authors: "Smith & Lee";
- three or more: "Smith et al.".

An organization, such as a library or an agency, shows by its full name. The line names the item's main creators: the authors for most items, or the main role for the item type, such as the person interviewed for an interview. When an item has none of these, the line names its editors, then its directors, then its contributors, and when it has none at all, the partial writes nothing.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block, for example under the title:

```liquid
{% render "author-line" with zt as zt -%}
```

To write "and" instead of "&", or "等" instead of "et al.", replace that text in the last line of the partial.
