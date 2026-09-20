# Annotation View redesign — prototype

Throwaway code that answered a question. **Not production code**: no tests, no error
handling, no abstractions, mock state only. It exists as the visual reference behind
[ANNOT-VIEW-DESIGN.md](../ANNOT-VIEW-DESIGN.md), and nothing here should be promoted by
copying — folding a decision in means rewriting it under production constraints.

## The question

What should the Annotation View look like for a researcher who does not think in
capabilities, local APIs or attachment keys? It was raised by a screenshot of the
Zotero-closed state, where the pane's only real information — "Zotero is not running" — sat
in a hover tooltip covering the whole view, above a message naming the wrong cause.

## Open it

Open **`annot-view-redesign.html`** in a browser. No build, no server; every dependency
arrives from a CDN. Its head comment records every decision in the order it was taken, with
the user's own words.

The bar along the bottom drives the design rather than switching between options — one
variant survives. It sets:

| Row | Drives |
| --- | --- |
| **State** | Reading · Zotero closed · No item · Saving · No matches |
| **Mode** | Active tab · Zotero reader · Pinned |
| **Files** | One file · Several · Reader holds it · PDF open here |
| **Width** | 340 / 520 / 900px, plus the light/dark and expanded-previews toggles |

Start at **Zotero closed** and **No item** — those are the two states the redesign was
called for.

## What is here

| | |
| --- | --- |
| `annot-view-redesign.html` | The final prototype. Self-contained. |
| `CONTRACT.md` | The brief every variant was built against — the question, the craft rules, the anti-patterns. |
| `ROUND2.md` … `ROUND5.md` | What each round changed, and why. |
| `round1/` `round2/` `round3/` | The earlier galleries, with the variants that lost. |

Each variant's source lives spliced inside its gallery, between `// --- Variant X ---`
markers. The loose `.jsx` files are not kept: they are fragments that read `Ic` and
`ObsidianFrame` from their host page, so they neither lint nor run on their own.

## How it got here

Each round put radically different shapes side by side, and the user picked.

1. **Three shapes.** Page-grouped scroll with no card boxes · a masthead with word-labelled
   controls · a continuous marginalia reading column. → the masthead won.
2. **Three homes for the read-only condition.** Byline · at the blocked verb · a status line
   on the pane edge. → merged: a byline hint plus one drawer.
3. **Three homes for the Follow Mode switch**, which no earlier round had covered at all.
   The title as the control · first in the control row · a pane menu. → the title won.
4. **Refinement**, in the user's order: the file picker moved into a menu and a suggester;
   the masthead collapsed to a status bar where the paper is already named; the header
   unified into one trigger and one menu; the chevron moved to the block; the filter
   controls got bounded active states.

The design guide holds the rules that survived. This directory holds the evidence.
