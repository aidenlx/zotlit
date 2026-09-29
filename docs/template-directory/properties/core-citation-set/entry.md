---
title: Core citation set
summary: Seven properties from one rule — title, authors, year, venue, citekey, DOI link, and Zotero link — each only when the item has a value.
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

The main citation details of every source as seven properties, from one rule. Use them to sort and filter your literature notes in an Obsidian Bases view or with the Dataview plugin, and to see a source's details at the top of its note.

| Property | Value |
| --- | --- |
| `title` | The item's title |
| `authors` | The authors as a list, one name per line, such as `Amos Tversky`. For an interview, the people interviewed; for a book with editors only, the editors |
| `year` | The year of the item's date, as a number |
| `venue` | The journal, book, or proceedings, or else the publisher or university |
| `citekey` | The citation key |
| `doi` | The DOI as a link, such as `https://doi.org/10.1017/CBO9780511809477.002` |
| `zotero-link` | A link that selects the item in Zotero |

A property is left out when the item has no value for it, so a note never shows an empty property or the word "null". A title with a colon or quotation marks stays a valid property.

What each kind of source gets:

- An article, a conference paper, or a book chapter: its journal, proceedings, or book as `venue`.
- A book, a thesis, or a document: its publisher or university as `venue`, when Zotero has one.
- A letter, a manuscript, or an interview: usually no `venue`.
- Any source: `doi` only when the item has a DOI.

**When the note is updated:** **Replace the existing value**. Each update writes the current values from Zotero, so correct a title or an author in Zotero, not in the note. If you delete a value in Zotero, such as the DOI, the property keeps its old value in the note until you delete it there too. If you delete a property from the note while Zotero still has its value, the next update adds it back.

To add the rule to a profile:

1. In Obsidian, open ZotLit's settings and go to **Literature note profiles**. On the row of the profile you want to change, select **Edit profile** (the pencil button). The Template Workbench opens.
2. Select the **Properties** tab, then **Add several properties from one rule**.
3. In **Value**, replace the example rule with this entry's rule: everything from the first `{` to the last `}`.
4. Set **When the note is updated** to **Replace the existing value**.

The preview shows the properties for the selected item. Notes get them the next time you create or update them. In the Simple reading note, the rule adds `authors`, `doi`, and `zotero-link`; `title`, `year`, `venue`, and `citekey` keep the same values.
