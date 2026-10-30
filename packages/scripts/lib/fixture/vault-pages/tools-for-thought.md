---
title: "Project: tools for thought"
---
# Project: tools for thought

Working notes on the lineage and design of tools that help researchers think, write, and
connect their reading. This page ties the hypertext vision to the knowledge-management
practice; see [[knowledge-management-survey]] for the literature review.

## The hypertext line

Bush proposed that a researcher's desk should surface associated documents through personal
"trails" rather than fixed indexes [@bushAsWeMayThink1945]. Nelson coined the term
*hypertext* and showed what happens when documents can point to one another through typed
links rather than sequential page numbers [@nelsonComplexInformation1965].

Engelbart extended the vision to collaborative augmentation — shared workspaces where a team
navigates a living web of ideas, not just a single reader's trail
[@engelbartAugmentingHuman1962].

Berners-Lee built the World Wide Web on these foundations, and later proposed that the same
web be enriched with machine-readable semantics so that software agents could follow citation
links on a reader's behalf [@bernersLeeSemanticWeb2001].

## From hypertext to knowledge management

Matuschak and Nielsen argued that the modern note-taking tool is a direct descendant of the
Memex, the hypertext terminal, and the slip-box — but that most implementations still fall
short of the original ambition [@matuschakTransformativeTools2019].

Forte's system translates the hypertext promise into a daily habit: capture what you read,
distill it progressively, and surface old notes when they connect to current work
[@forteBuildingSecondBrain2022].

Ahrens showed that a slip-box — physical or digital — works because it externalises thinking
into a network of permanent notes, each connected to its neighbours
[@ahrensHowTakeSmartNotes2017].

## Template Data Explorer permissions

1. Open this note and run **ZotLit: Open template data explorer**. Choose a Zotero item. Open a field's **Template actions** menu. With JavaScript templates disabled, **Copy output** uses Liquid.
2. Enable JavaScript templates in ZotLit's template settings, then open the same field menu. **Liquid** and **Eta** submenus are available.
3. Disable JavaScript templates while the Explorer stays open, then open the field menu. **Copy output** uses Liquid and the Eta submenu is absent.
4. Open a second Explorer and give each a different search. Change the permission again. Both field menus follow the permission, and each Explorer keeps its search. Close both leaves. Their data reads and permission subscriptions stop.
