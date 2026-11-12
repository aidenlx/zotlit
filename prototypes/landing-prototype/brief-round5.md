# Round 5 brief: a first screen led by the Library View and ZotLit Query

Read `brief-round4.md` in this folder first: its "product and reader", "Technical
contract" and "Recordings" sections still apply (tokens, fit above the fold at 1440x900
and 390x844, motion with reduced-motion, one file, compile check, preview.py, screenshots).
This file replaces its "question" and "copy" sections.

## What changed
The owner: the Library View and ZotLit Query are what make ZotLit stand out (other
Obsidian plugins already cite from Zotero; none gives you your Zotero library as a
browsable tab and live, queryable tables). Round 4 led with citing and highlights; this
round leads with the library and the query. Keep round 4's ambition: editorial, striking,
one real aesthetic risk, the product moment enacted in HTML/CSS with real data.
Do NOT mention that annotations or highlights save or write back to Zotero (owner:
"not worthy"). Citations and notes may appear as supporting detail, not the lead.

## Copy
- Headline (keep its words): "A research desk for Zotero in Obsidian."
- Lede (new, use it or a tighter true variant): "Browse your Zotero library in an Obsidian
  tab, and turn any collection into a live table you can sort, filter and rate."
- Buttons: "Install ZotLit" (primary), "Start the tutorial". Requirements line from FACTS.
- True facts you may state:
  - Library View: your Zotero collections in an Obsidian tab: Recent first, then each
    library with its collections nested as in Zotero, each with its paper count; filters
    Unread, Annotated, Has note, PDF; tags under the tree, as in Zotero; search by title,
    author or tag; group libraries too; it reads Zotero on your computer, Zotero can stay
    closed.
  - Recent: the papers you last read, cited or annotated come first, each with the reason,
    such as "read 2 h ago in Obsidian".
  - Reading Card: the selected paper laid out like a title page: type, title, authors,
    venue, citation key, tags, files, your Zotero notes, your annotations, with "Open PDF"
    and "Write literature note".
  - ZotLit Query: a live table, card wall, list or annotation board of any part of your
    library. Save it as a file (`.zotquery`) or put it in a note (a `zotquery` block, or
    embed `![[Reproducibility.zotquery]]`). It reads Zotero every time it opens, so new
    papers appear by themselves. Sort, group, filter, choose columns. Add your own column,
    such as a rating, which lives in each paper's literature note. Copy the table into a
    chapter or export CSV. "Save as query file" turns what the Library View shows into a
    query file.
  - Layouts of a query: Table, Papers, List, Cards, Annotations.
- Invent nothing else: no numbers, testimonials, prices, user counts, no AI claims.

## Real data (from the lesson vault; use exactly)
- Library tree: Recent · Libraries › My Library (5) › Data visualization (1),
  Reproducibility (4). Tags: methodology, reproducibility, research-practice, visualization.
- Papers (Reproducibility unless noted), with citekeys:
  - Ioannidis, J. P. A. (2005) "Why Most Published Research Findings Are False", PLoS Medicine — ioannidis2005 — rating 5
  - Sandve, G. K., Nekrutenko, A., Taylor, J., Hovig, E. (2013) "Ten Simple Rules for Reproducible Computational Research", PLOS Computational Biology 9(10), e1003285 — sandve2013 — rating 5 — tags reproducibility, research-practice; file "Full Text PDF"; Zotero note "Ten rules: what to change in my lab"; added November 21, 2024; annotations 1 yellow, 1 red, 1 green, 1 blue, 1 purple; first annotation "good habits of reproducibility may actually turn out to be a time-saver in the longer run."
  - Wilson, G., Aruliah, D. A., Brown, C. T. et al. (2014) "Best Practices for Scientific Computing", PLOS Biology — wilson2014 — rating 3
  - Munafò, M. R., Nosek, B. A., Bishop, D. V. M. et al. (2017) "A manifesto for reproducible science", Nature Human Behaviour — munafo2017 — rating 4
  - Rougier, N. P., Droettboom, M., Bourne, P. E. (2014) "Ten Simple Rules for Better Figures", PLOS Computational Biology — Data visualization collection
- Query file: `Thesis/Reproducibility.zotquery`, view "Papers", "4 results", toolbar
  Sort 1 · Group · Filter 2 · Properties · Search; Table columns Title · Literature note ·
  Year · Publication · Creators · rating (note); sorted by year, old to new.
- Recent reasons (real formats, {time} like "2 h ago" or "yesterday"): "opened {time} in
  Obsidian", "read {time} in Obsidian", "cited {time} in Obsidian", "read {time} in Zotero",
  "added to Zotero {time}", "notes edited in Zotero {time}".
- ZotLit's UI accent in Obsidian is Obsidian's purple (#8a5cf5) on selected rows and
  primary buttons; you may use it inside an enacted app window only, sparingly.
