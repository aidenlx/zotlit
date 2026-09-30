---
title: Plain author–year citations
summary: Inserts plain author–year citations, in parentheses or in the flow of your sentence, for writing that does not go through Pandoc.
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

A `/` at the end of your search in the citation suggester gives the alternate form, as Shift+Enter does. Without authors, it shows editors, then directors, then contributors.

The inserted citation is plain text. It shows no preview on hover and does not open the literature note. Pandoc, which builds a reference list from `[@citekey]` citations, cannot read it. If you need them, keep the built-in citation text.

This entry replaces the one citation text of your vault. Citations already in your notes stay as they are. To keep a copy first, paste the text of the **Citation** tab into a note. **Reset to default** next to **Citation text** in the **Citations** settings brings back the built-in text.
