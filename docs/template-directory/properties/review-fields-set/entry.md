---
title: Literature review fields
summary: Empty contribution, method, and relevance properties for your own judgment of each source, so a Bases view becomes a literature review matrix.
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
audience: Literature reviewers who want to compare sources side by side in an Obsidian Bases view or a table of the Dataview plugin.
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

Write a few words in each property: what the source adds, how the authors did the work, and how it relates to your question.

When you update the note, ZotLit fills a property only when it is missing or empty, so your words stay. A note that you have now gets the three properties at its next update. If you delete one, the next update adds it back empty.

A property holds one line of text. Write longer thinking under your own heading in the note, outside the part that ZotLit refreshes. To use other names, such as `findings`, change or add names in the rule, and give each the value `null`, which means empty.
