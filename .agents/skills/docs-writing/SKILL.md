---
name: docs-writing
description: >
  Write end-user documentation using the Diataxis framework. Use when writing
  a new doc page, restructuring or improving existing docs, or documenting a
  feature for users.
---

# Documentation Writing

Write for **end users** — people who use the product, not build it. Use terms the audience already knows; avoid programmer jargon. When introducing a product-specific term, define it on first use and use that one name consistently everywhere.

## The Diataxis Principle

Every doc page serves exactly one of four purposes. Mixing them makes the whole documentation worse — harder to read, harder to maintain.

| Type | Purpose | How to write it |
|------|---------|-----------------|
| **Tutorial** | Help a newcomer learn by doing | Learning-oriented: guided, concrete steps toward a visible result. Prescriptive — pick one concrete example and walk through it exactly. |
| **How-to** | Solve a specific real-world problem | Problem-oriented: numbered steps to a goal. The reader already knows enough to ask the question. Title: "How to [verb] [thing]". |
| **Reference** | Describe the machinery | Information-oriented: complete, consistent, neutral. Tables and lists of commands, settings, properties. No opinions, no "you should". |
| **Explanation** | Provide background and context | Understanding-oriented: what a feature is, why it exists, how concepts connect. Link to how-to guides for instructions. |

While writing, keep checking: "which quadrant am I in?" Content that answers a different quadrant's question moves to a page of that type, with a link left behind.

### Distinctions that blur

- **Tutorial vs how-to:** A tutorial teaches a newcomer through a guided exercise; a how-to solves a specific problem for someone who already knows the basics. In a tutorial, you decide everything the reader does — no choices, no "alternatively". Alternatives belong in how-to guides, where the reader has context to decide.
- **Reference vs explanation:** Reference describes *what* exists; explanation describes *why* it works that way. "The reason this works is…" in a reference page belongs in an explanation page.
- **Explanation vs how-to:** Explanation pages cover concepts and capabilities. "To do this, click…" in an explanation page belongs in a how-to guide.

## Writing Style

**Voice:** Friendly and direct, like explaining to a friend. Address the reader as "you" — "You can adjust playback speed…" not "Users can adjust…"

**Sentences:** Active voice, present tense. Under 20 words where possible. One idea per sentence. Paragraphs of 2–3 sentences max.

**Structure:** Start each page with a one-line summary. Use headings liberally for scanning. Essential info first, edge cases later — happy path first, warnings after.

## Page Patterns

Frontmatter on every page: `title` (under 60 chars, sentence case) and `description` (under 160 chars).

**Explanation page:** one-sentence summary → when/why you'd use this → concepts explained → links to related how-to and reference pages.

**How-to page:** title "How to [verb] [thing]" → one sentence on when you'd need this → numbered steps → expected result → optional "See also" links.

**Reference page:** one sentence on what this reference covers → tables with consistent columns, grouped by functionality.

## Reference Materials

Two documents in `references/` hold the reasoning behind the guidelines above. Read them when making judgment calls about structure, tone, or organization:

- **`references/what-nobody-tells-you-about-documentation.txt`** — Daniele Procida's PyCon talk introducing Diataxis. Read when deciding between quadrants, especially tutorial vs how-to. Key insight: tutorials build learner confidence through guided exercises, not information transfer.
- **`references/Exploring User-Friendly Documentation.md`** — analysis of documentation best practices: plain language, industry style guides, progressive disclosure, page structure, accessibility. Read when making sentence-level or page-structure decisions; it has specific cited guidelines.
