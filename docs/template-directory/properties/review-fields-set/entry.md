---
title: Literature review fields
summary: Three empty properties for your own judgment of each source — contribution, method, and relevance — that keep your words when the note updates.
minAppVersion: "2.2.0-beta.0"
tasks: [literature-review]
features: [properties]
problems:
  - I want a literature review table with the contribution and method of every paper.
  - I want to record how each paper is relevant to my project.
  - My notes on a paper get overwritten when the note updates.
  - How do I build a literature matrix in Obsidian?
keywords:
  - literature review
  - systematic review
  - literature matrix
  - review table
  - synthesis
  - contribution
  - method
  - methodology
  - relevance
  - persist
  - frontmatter
  - YAML
  - properties
  - Bases
  - Dataview
  - spread entry
audience: Literature reviewers who want to compare sources side by side in an Obsidian Bases view or a Dataview table.
effort: Add one rule to your profile in the Template Workbench. Then write your own words into the three properties of each note.
expected:
  journal-article: { contribution: null, method: null, relevance: null }
  conference-paper: { contribution: null, method: null, relevance: null }
  book: { contribution: null, method: null, relevance: null }
  thesis: { contribution: null, method: null, relevance: null }
  book-section: { contribution: null, method: null, relevance: null }
  letter: { contribution: null, method: null, relevance: null }
  manuscript: { contribution: null, method: null, relevance: null }
  interview: { contribution: null, method: null, relevance: null }
  document: { contribution: null, method: null, relevance: null }
---

Three empty properties for your own judgment of every source, from one rule. Write a few words or a sentence in each, then compare your sources side by side in an Obsidian Bases view or a Dataview table: one row per source, one column per property, like a literature review matrix.

| Property | What you write |
| --- | --- |
| `contribution` | What the source adds: its main finding or argument |
| `method` | How the authors did the work: the design, data, or approach |
| `relevance` | How the source relates to your own project or question |

ZotLit writes the three properties empty when it creates the note. Every kind of source gets the same three.

**When the note is updated:** **Keep the existing value**. An update never changes what you write. It fills a property only when it is empty or missing, so if you delete one of them from a note, the next update adds it back empty.

To add the rule to a profile:

1. In Obsidian, open ZotLit's settings. Under **Profiles**, select **Edit profile** (the pencil button) on the profile you want to change. The Template Workbench opens.
2. Select the **Properties** tab, then **Add several properties from one rule**.
3. In **Value**, replace the example rule with this entry's rule: everything from the first `{` to the last `}`.
4. Set **When the note is updated** to **Keep the existing value**.

A property holds one line of text. Keep it to a short summary, and write longer thinking under your own heading in the note, such as **My notes**, outside the part that ZotLit refreshes. To use other names, such as `findings` or `limitations`, change or add names in the rule, each with the value `null`, which means empty.
