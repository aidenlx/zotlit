---
name: grill-frontend-prototyping
description: Converge on a frontend look through rounds of prototypes and grilling verdicts. Use when the user wants to iterate on UI/visual taste against concrete variants, or a wayfinder prototype ticket names this skill.
---

Run a `/grilling` session where each question is asked with prototypes, not
words.

Each round is one `/prototype` UI-branch build — read UI.md end-to-end and
follow its pipeline (template, one code-edit subagent per variant, assemble,
publish as Artifact) — with these deltas:

- 5 variants per round, not the default 3.
- One HTML file for the whole session, updated in place each round.
- The switcher is a draggable bottom-right picker; when the design has
  meaningful states (an inbox: full vs empty), add picker buttons toggling
  the mock between them.

The grilling walks down the visual design tree: overall design -> component
groups -> individual components. A round is complete when the Artifact is
published, the round's verdict is recorded as a comment in the HTML, and
exactly one next question is posed. The session is complete when every level
has a recorded verdict; then trim to the final winner and hand off per UI.md.
