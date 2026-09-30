---
title: Aliases
summary: Two aliases for each note, author and year, and first author and title, so a link to the note finds it by either.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, writing]
features: [properties]
problems:
  - I want to link to a paper by typing its author and year.
  - I want to find a literature note by author when its name is a citekey.
  - Aliases I add by hand disappear when the note updates.
keywords:
  - aliases
  - alias
  - author year
  - author-date
  - et al.
  - link suggestions
  - wikilink
  - authorsShort
audience: Readers whose notes are named by citation key or title and who link to them by author and year.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article:
    aliases:
      - Ioannidis 2005
      - Ioannidis – Why Most Published Research Findings Are False
  conference-paper:
    aliases:
      - Rivera & Chen 2026
      - Rivera – Designing reproducible research interfaces
  book:
    aliases:
      - Kahneman 2011
      - Kahneman – Thinking, fast and slow
  book-section:
    aliases:
      - Tversky & Kahneman 1982
      - "Tversky – Judgment under uncertainty: Heuristics and biases"
  thesis:
    aliases:
      - Batista 2010
      - "Batista – Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities"
  document:
    aliases:
      - Brackenridge Free Library 1923
      - Brackenridge Free Library – Minutes of the Board of Trustees, 12 March 1923
---

Two aliases for each literature note, as its `aliases` property:

- the family names of the authors and the year, as in an author–date citation: `Ioannidis 2005` for one author, `Rivera & Chen 2026` for two, and `Ioannidis et al. 2005` for three or more;
- the family name of the first author and the title: `Ioannidis – Why Most Published Research Findings Are False`.

The aliases are the same whatever language Obsidian and ZotLit use.

When you type `[[` in Obsidian, the link suggestions find the note by either alias, also when the note is named by its citation key.

| Item | `aliases` |
| --- | --- |
| Journal article | Ioannidis 2005; Ioannidis – Why Most Published Research Findings Are False |
| Book | Kahneman 2011; Kahneman – Thinking, fast and slow |
| Book chapter | Tversky & Kahneman 1982; Tversky – Judgment under uncertainty: Heuristics and biases |
| Thesis | Batista 2010; Batista – Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities |

An alias is left out when a part of it is missing: an item with no year gets no author-and-year alias, and an item with no authors gets neither alias.

**When the note is updated**: **Add to the existing list**. ZotLit adds each alias the note does not have yet, and keeps every alias already in the note, so an alias you add by hand stays.

Limits:

- When you correct an author, the year, or the title in Zotero, the note gets the new alias and keeps the old one. Delete the old alias in the note by hand.
- Two works by one author in one year get the same author-and-year alias.
- When the note holds `aliases` as text and not as a list, ZotLit leaves it as it is and adds no alias.
