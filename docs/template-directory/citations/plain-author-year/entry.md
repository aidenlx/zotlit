---
title: Plain author–year citations
summary: Inserts readable in-text citations such as (Smith 2020) and Smith (2020), with no Pandoc needed.
minAppVersion: "2.2.0-beta.0"
tasks: [writing]
features: [citations]
problems:
  - I want citations like (Smith 2020) in my notes, not [@smith2020].
  - I don't use Pandoc. I just want plain author–year text.
  - How do I change what the citation suggester inserts?
  - I want a narrative citation such as "Smith (2020) shows".
  - I want each quote to end with (Author Year, p. 5).
keywords:
  - author-date
  - author-year
  - in-text citation
  - parenthetical citation
  - narrative citation
  - Harvard
  - Chicago
  - cite
  - cite2
  - citation template
  - citation text
  - citation suggester
  - Shift+Enter
  - et al.
  - no Pandoc
audience: Writers who want readable author–year citations in their notes and do not turn them into a bibliography with Pandoc.
effort: Replace your citation text with this one. It changes every citation ZotLit inserts from then on, in every profile.
---

Every citation ZotLit inserts becomes plain author–year text:

| In the citation suggester | You get |
| --- | --- |
| Enter | (Smith 2020) |
| Shift+Enter, or a `/` at the end of your search | Smith (2020) |

- One author shows as `Smith`, two as `Smith and Lee`, and three or more as `Smith et al.` An organization shows with its full name.
- The names are the item's main creators: its authors, or, when it has none, its editors. An interview shows the person interviewed.
- An item with no creator shows its short title, or else its title. An item with no date shows `n.d.` for the year.
- Several items in one citation are separated by semicolons: (Smith 2020; Lee 2021).
- A page follows the year: (Smith 2020, p. 5). When a profile shows the citation of a highlight, it reads this way, with the highlight's page.
- A citation in a Zotero note that ZotLit imports keeps its extra text and its page, such as (see Smith 2020, p. 5). A citation that leaves out the author in Zotero shows the year alone: (2020).

Plain text is not a Pandoc citation. ZotLit does not recognize (Smith 2020) as a citation after you insert it: hovering over it shows no preview, selecting it does not open the literature note, and Pandoc cannot build a reference list from it. If you need these, keep the built-in citation text.

Your vault has one citation text, the file `zotlit-citation.md` in your template folder. This entry replaces it, so it changes the citations of every profile. Citations already in your notes stay as they are.

To use it:

1. Run **Customize citation text** in Obsidian. The citation text opens in the Template Workbench View.
2. To keep a copy of your current citation text, select all of its text, copy it, and paste it into a note of your own. You need no copy if you never changed it: **Reset to default** on the **Citation text** row in the **Citations** settings brings back the built-in text at any time.
3. Replace all of the text with the text of this entry.
