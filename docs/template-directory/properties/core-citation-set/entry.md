---
title: Core citation set
summary: "Seven citation properties from one rule: title, authors, year, `venue`, `citekey`, DOI link, and Zotero link, each only when the item has a value."
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, writing]
features: [properties, source-links]
problems:
  - I want the basic citation details of every paper as properties.
  - I want to sort and filter my literature notes by author, year, and journal in Bases.
  - My properties show "null" when a field is empty in Zotero.
  - A title with a colon breaks my note's YAML.
  - How do I add several properties at once?
keywords:
  - frontmatter
  - YAML
  - metadata
  - properties
  - Bases
  - Dataview
  - authors
  - year
  - journal
  - venue
  - citekey
  - DOI
  - Zotero link
  - bibliographic data
  - spread entry
audience: Readers who want the main citation details of each source as properties, ready for an Obsidian Bases view or the Dataview plugin.
effort: Add one rule to your profile in the Template Workbench. No other setup.
expected:
  journal-article:
    title: Why Most Published Research Findings Are False
    authors: [John P. A. Ioannidis]
    year: 2005
    venue: PLoS Medicine
    citekey: ioannidisWhyMost2005
    doi: https://doi.org/10.1371/journal.pmed.0020124
    zotero-link: zotero://select/library/items/IANNP5A2
  conference-paper:
    title: Designing reproducible research interfaces
    authors: [Mara Rivera, Tao Chen]
    year: 2026
    venue: Proceedings of the Open Research Conference
    citekey: riveraResearchInterfaces2026
    zotero-link: zotero://select/library/items/CNPF226A
  book:
    title: Thinking, fast and slow
    authors: [D Kahneman]
    year: 2011
    venue: Penguin Books
    citekey: Kahneman2011
    zotero-link: zotero://select/library/items/NW2CPDTC
  thesis:
    title: "Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities"
    authors: [Edgard Antunes Dias Batista]
    year: 2010
    citekey: Batista2010
    zotero-link: zotero://select/library/items/I49R3FTL
  book-section:
    title: "Judgment under uncertainty: Heuristics and biases"
    authors: [Amos Tversky, Daniel Kahneman]
    year: 1982
    venue: "Judgment under Uncertainty: Heuristics and Biases"
    citekey: tverskyJudgmentUncertaintyHeuristics1982
    doi: https://doi.org/10.1017/CBO9780511809477.002
    zotero-link: zotero://select/library/items/TVKHEUR1
  letter:
    title: Letter to Eleanor Whitcombe
    authors: [Henry Aldous]
    year: 1887
    citekey: aldousLetterEleanorWhitcombe1887
    zotero-link: zotero://select/library/items/ALDLET87
  manuscript:
    title: Survey notebook of the Brackenridge estate
    authors: [Henry Aldous]
    year: 1885
    citekey: aldousSurveyNotebookBrackenridge1885
    zotero-link: zotero://select/library/items/ALDMSS85
  interview:
    title: Oral history interview with Ada Okafor
    authors: [Ada Okafor]
    year: 2019
    citekey: okaforOralHistoryInterview2019
    zotero-link: zotero://select/library/items/OKAFOH19
  document:
    title: Minutes of the Board of Trustees, 12 March 1923
    authors: [Brackenridge Free Library]
    year: 1923
    venue: Brackenridge Free Library
    citekey: brackenridgefreelibraryMinutesBoardTrustees1923
    zotero-link: zotero://select/library/items/BFLMIN23
---

`venue` is the journal, book, or proceedings. Without these, `venue` is the publisher or university. `authors` lists the people interviewed for an interview, and the editors of a book with no authors. A title with a colon or quotation marks stays a valid property.

Each update writes the current values from Zotero, so correct values in Zotero. A value you delete in Zotero stays in the note until you delete it there. A property you delete from the note comes back on the next update while Zotero still has its value.

The **Simple reading note** already writes `title`, `year`, `venue`, and `citekey` with the same values, so there the rule adds `authors`, `doi`, and `zotero-link`.
