---
title: Aliases
summary: Two aliases on each note, authors with year and first author with title, so the link suggestions find the note by either.
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

With three or more authors, the first alias names the first author and "et al.". The aliases do not change with the language of Obsidian.

An item with no year gets no author-and-year alias. An item with no authors gets no alias.

Each update adds missing aliases and keeps every alias already in the note, also the ones you add by hand.

- A correction in Zotero to an author, the year, or the title adds a new alias and keeps the old one. Delete the old one by hand.
- Two works by one author in one year get the same author-and-year alias.
- When `aliases` holds text and not a list, ZotLit adds no alias.
