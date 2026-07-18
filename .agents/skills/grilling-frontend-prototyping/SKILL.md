---
name: grilling-frontend-prototyping
description: Converge on a frontend look through rounds of prototypes and grilling verdicts. Use when the user wants to iterate on UI/visual taste against concrete variants, or a wayfinder prototype ticket names this skill.
---

Run a `/grilling` session, using the `/prototype` skill — each question is asked with prototypes, not words:

- Each round, build 5 radically different prototypes of the current design
  question into one live mocked app: one standalone HTML file (Artifact
  tool), updated in place each round.
- A floating bottom-right draggable picker names each design; ←/→ arrows
  switch between them, restyling the mocked app live. When the design has
  meaningful states (an inbox: full vs empty), add picker buttons that toggle
  the mock between them.
- The grilling walks down the visual design tree, each verdict zooming in
  one level: the overall design, then component groups, then individual
  components — until the user has designed the entire feature in detail.
