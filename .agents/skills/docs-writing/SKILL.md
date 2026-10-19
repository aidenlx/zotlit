---
name: docs-writing
description: >
  Author and structure end-user documentation for ZotLit and academic tools. Reach when writing new documentation pages, reorganizing the docs content tree, adapting technical features for academic researchers, or auditing page prose and user-interface labels.
---

# Documentation Writing

Reference for authoring and restructuring end-user documentation for ZotLit. Focus on academic researchers as the primary audience: assume deep scholarly domain expertise and non-technical backgrounds. Present the product as an integrated visual research desk centered on the Library View, rather than a headless database tool or template engine.

## Authoring Sequence

Follow these steps in order when creating or updating documentation:

### 1. Scope and Placement
Determine where the topic fits within the research workflow lifecycle:
- **Getting Started**: Installation, connection, opening the Library View, first literature note.
- **Reading & Library**: Navigating collections, search, Reading Cards, reading PDFs, reading status.
- **Literature Notes**: Creating notes, note updates via the managed region, annotations, importing.
- **Citing & Writing**: Drag-and-drop citation, Better BibTeX keys, graph view, Pandoc exports.
- **Organizing & Tables**: Query files, query blocks, dynamic literature review tables.
- **Templates & Customization**: Visual Template Workbench, profile documents, frontmatter (power-user tier).
- **Sync & Companion**: Companion setup, live sync, multi-device setups.
- **Reference & Troubleshooting**: Settings, commands, error recovery, migration guides.

Confirm the page archetype (Tutorial, How-to, Reference, Explanation) before writing. Keep each document bound to a single archetype.

### 2. State the Research Outcome
Begin every page with frontmatter and a one-sentence summary that states the tangible academic outcome:
- Focus on the scholar's goal (e.g. "Extract quoted passages with accurate page numbers into your note") rather than the technical mechanism (e.g. "Execute annotation serialization pipeline").

### 3. Draft the Visual Happy Path
Guide the reader through the primary interface path first:
- Prioritize the visual interface: the Library View, Reading Card, PDF reader, and Obsidian ribbon/menus.
- Present steps as numbered actions in the active voice and imperative mood ("Select...", "Open...").
- Include visual cues describing what the user sees upon completing each step.
- Reserve keyboard shortcuts, configuration flags, and edge cases for secondary headings or callouts.

### 4. Apply Progressive Disclosure
Keep technical complexity segregated by user intent:
- Core research workflows (reading, annotating, creating notes, citing) must remain code-free.
- Place template variables, Eta/JavaScript syntax, SQLite mechanics, and CLI flags in the *Templates & Customization* or *Reference* sections.
- When a workflow touches technical machinery (such as the literature note *managed region*), explain the human rule first: "Write your personal thoughts above or below the markers so ZotLit can refresh your highlights without touching your writing."

### 5. Verify UI Labels and Stable Anchors
Treat interface text as verifiable software contracts:
- Import and render product-owned labels using the project's typed message API (`<UiLabel name={m.label_name()} />`) in MDX files.
- Verify host application labels (Obsidian, Zotero) against the running applications.
- Provide stable explicit heading anchors using the `[#custom-slug]` syntax for every deep-link target.

### 6. Audit Tone and Completion
Evaluate the drafted page against the completion criteria:
- Sentence length: Under 20 words per sentence.
- Paragraph length: 2 to 3 sentences maximum.
- Voice: Active voice, present tense, second person ("you").
- Audit with the `slop-check` skill and resolve any flagged issues.

---

## Page Archetypes (Diataxis at Page Level)

Maintain strict separation of page purposes across individual documents:

| Archetype | Primary Purpose | Tone & Orientation | Structure |
| :--- | :--- | :--- | :--- |
| **Tutorial / Quickstart** | Teach a newcomer through a guided exercise | Calm Guide: step-by-step reassurance, single concrete example, zero choices. | Summary $\to$ Prerequisites $\to$ Step-by-step sequence $\to$ Verifiable end result. |
| **How-to Guide** | Solve a specific research task | Direct Manual: goal-oriented, practical, assumes basic familiarity. | Title "How to [action] [target]" $\to$ Context summary $\to$ Numbered steps $\to$ Expected outcome. |
| **Reference** | Provide complete technical facts | Neutral Ledger: factual, complete, structured in tables. | Scope statement $\to$ Grouped tables of options, commands, or data fields. |
| **Explanation** | Clarify concepts and relationships | Analytical: conceptual background, system mental models. | Conceptual overview $\to$ Why the system works this way $\to$ Links to relevant how-to guides. |

### Blended Boundary Rules
- When a how-to guide requires technical theory, summarize the practical effect in one sentence and link to an Explanation page.
- When an explanation mentions actionable tasks, link to the corresponding How-to guide rather than inserting numbered action steps.
- When a tutorial encounters options, select one sensible default and walk through it; link to How-to guides for alternative configurations.

---

## Tone Registers

Match the tone register to the page's position in the user journey:

### Calm Guide (Onboarding & Tutorials)
- **Role**: Getting Started, Quickstart, and initial setup walks.
- **Cadence**: Patient, supportive pacing. Reassure the user by explicitly describing what appears on screen at each milestone.
- **Punctuation**: Restrained periods and colons. Warmth stems from clarity, predictability, and respect for attention.

### Direct Manual (Everyday Guides & How-tos)
- **Role**: Core reading, note-taking, citing, and organizing workflows.
- **Cadence**: Terse, direct, second person ("you"). Lead with the action verb.
- **Punctuation**: Declarative statements. State what is on screen and what action to take next.

### Neutral Ledger (Reference)
- **Role**: Command listings, settings indexes, template field catalogs, and theme hooks.
- **Cadence**: Objective statements and structured tables. Free of subjective recommendations.

---

## Frontmatter and Layout Standards

Every documentation page requires standard frontmatter:

```yaml
---
title: "Sentence case title under 60 characters"
description: "Active summary stating user outcome under 160 characters."
---
```

Use standard MDX components where appropriate:
- `<Steps>` and `<Step>` for ordered procedures.
- `<Callout type="info" | "warn" | "tip">` for progressive disclosure and important platform notes.
- `<Cards>` and `<Card>` for navigational crossroads and next steps.
- `<UiLabel name={m...} />` for all typed UI strings.
- `<Command name={m...} />` for Obsidian command palette entries.

---

## Search Intent & Organic SEO (Non-Branded Discovery)

Users rarely search for "ZotLit" before adopting it. They search for workflows, problems, and host tools: "zotero obsidian integration", "how to read zotero pdfs in obsidian", "cite zotero in obsidian", "import zotero highlights to obsidian". Write titles, descriptions, and headings to capture external search intent:

### 1. Title Formulation: Context Keywords + Exact Task
The site renders page titles as `<title>{title} | ZotLit</title>`. A title without host tool names wastes the highest-weight SEO signal.
- **Prefer**: Task and context keywords together (`"Read Zotero PDFs and annotations in Obsidian"`, `"Browse your Zotero library in Obsidian: Library View"`).
- **Avoid**: Pure internal or insular titles (`"Open an item's PDF in Obsidian"`, `"Browse your library in the Library View"`).

### 2. Search-Targeted Quick How-To Guides
Maintain dedicated, tight how-to guides matching high-volume academic search queries:
- **Connection & Setup**: `"How to connect Zotero to Obsidian"` (matches *zotero obsidian integration*, *zotero sqlite obsidian*).
- **PDF & Annotations**: `"How to read Zotero PDFs and highlights in Obsidian"` (matches *zotero pdf obsidian*, *read zotero annotations in obsidian*).
- **Literature Notes**: `"How to create Zotero literature notes in Obsidian"` (matches *zotero literature note obsidian*, *import zotero notes*).
- **Citing & Pandoc**: `"How to cite Zotero sources in Obsidian markdown"` (matches *cite zotero obsidian*, *pandoc zotero obsidian citations*).
- **Alternative & Migration**: `"Migrate from Obsidian Zotero Integration plugin to ZotLit"` (matches *obsidian zotero integration plugin*, *zotero integration alternative*).

### 3. Frontmatter Description Snippets
Search engines truncate SERP descriptions around 155–160 characters.
- Front-load the exact search intent in the first 120 characters: state the specific problem solved and the two tools involved ("Connect Zotero 7 to Obsidian to read annotated PDFs, write literature notes, and cite sources directly in your vault...").
- Keep descriptions strictly active and descriptive without generic filler ("Learn how to use...").

---

## Completion Criteria

A page or documentation change is complete when all of the following hold:
1. **Target Audience Aligned**: Prose uses academic vocabulary (papers, literature notes, citations) and explains features through research outcomes.
2. **Archetype Pure**: Content strictly matches its designated quadrant (Tutorial, How-to, Reference, or Explanation).
3. **Happy Path First**: The visual interface (Library View, Reading Card, PDF viewer) is described before keyboard shortcuts, advanced settings, or template syntax.
4. **UI Contracts Valid**: All UI labels match their authoritative message catalogs; product strings use typed messages in MDX.
5. **Stable Anchors Added**: Every heading that acts as a navigation target includes an explicit `[#anchor]` slug.
6. **Readability Standards Met**: Sentences stay under 20 words, paragraphs stay under 3 sentences, active voice is maintained throughout.
7. **Slop Audit Clean**: Text passes the `slop-check` review without unaddressed flags.

---

## Disclosed Reference Materials

Consult these reference documents for deeper theoretical background:
- [`references/Exploring User-Friendly Documentation.md`](references/Exploring%20User-Friendly%20Documentation.md) — Analysis of user cognitive ergonomics, plain language standards, active voice psychology, and inverted pyramid structures.
- [`references/what-nobody-tells-you-about-documentation.txt`](references/what-nobody-tells-you-about-documentation.txt) — Daniele Procida's foundational exposition on Diataxis and the four documentation modes.
