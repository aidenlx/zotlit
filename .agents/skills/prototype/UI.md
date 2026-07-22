# UI Prototype

Generate **several radically different UI variations** in one standalone HTML file, switchable from a floating bottom bar. The user flips between variants, keeps one (or steals bits from each), and throws the rest away.

A question about logic/state rather than looks belongs on the other branch — [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this page look like?"
- "Show me a few options for this dashboard before I commit."
- "Try a different layout for the settings screen."

## The deliverable

**One self-contained `.html` file** — React + Tailwind + Babel over CDN, zero build — opened straight from disk in the browser; it never leaves the machine.

`template.html` (next to this file) is the **source of truth** for that boilerplate: CDN imports, the switcher bar, hash routing, keyboard nav, and three placeholder `VariantA`/`VariantB`/`VariantC` bodies. Every prototype starts by copying it.

## Process

### 1. Frame the question, pick N

Default **3 variants**; **5** is the ceiling — past that they stop being radically different. Record the plan as a comment at the top of the copied HTML.

When variants are interactive (selections, toggles, a mock filter), wire the state into the copied template before delegating: **one shared store in the harness**, defined above the variant placeholders and read through a hook (`useProtoState()`). Flipping variants then keeps the scenario, so the user compares shapes in the same state instead of rebuilding it in each variant. Scenario presets — switcher buttons that jump the mock to a telling state ("empty inbox", "3 selected") — mutate this store and live in the switcher, never in a variant.

### 2. Delegate each variant to a `code-edit` subagent

One `code-edit` subagent per variant (`subagent_type: code-edit`), drafting in parallel. Each receives:

- the design question plus any reference (screenshots, existing UI, spec link),
- the project's visual language / design tokens if known,
- its own write path (`$SCRATCHPAD/variant-A.jsx`, ...) — one file each keeps parallel writes isolated,
- the contract: **write a single paramless `function VariantA() {...}` in Tailwind classes to that file — mock state comes from the shared hook, never from props — and return only the path.** JSX is bulky; keeping it out of the orchestrator's context is the point.

You orchestrate; the subagents write the variant code.

### 3. Assemble

1. `cp .claude/skills/prototype/template.html "$SCRATCHPAD/prototype-<feature>.html"`
2. **Splice** the variants in with `assemble.py` (next to this file) — file->file, so the JSX never enters your context:
   ```sh
   .claude/skills/prototype/assemble.py "$SCRATCHPAD/prototype-<feature>.html" \
     "$SCRATCHPAD"/variant-*.jsx --name 'A=Sidebar nav' --name 'B=Single scroll'
   ```
   Each `variant-<KEY>.jsx` replaces the matching `Variant<KEY>` placeholder; `--name KEY=Label` sets the switcher label.

Prototype files live in the scratchpad, clear of the project tree. Done when the splice reports every variant placed — then go straight to step 4: the user's own flip-through is the inspection.

### 4. Hand it over

Hand over the file path for the user to open directly in the browser — the file is self-contained, so no server and nothing published anywhere. The user flips through variants using the switcher bar and arrow keys, then answers — usually **"header from B, sidebar from C"**.

A broken or too-similar variant — whether the user catches it or you spot it — goes back to the same subagent: `SendMessage` it the feedback for a patch, re-assemble; the user reloads the page.

### 5. Capture the answer

The user's answer may name a variant loosely — a bare number ("3"), a position ("the last one"), a key ("C"), or a mix-and-match ("header from B, sidebar from C"). Resolve it before writing anything:

- **Single clean winner** (number/position/key, or a name that maps to exactly one switcher entry): map it to its `key` in the `VARIANTS` array — position and switcher order match, so "3" is whichever variant is third in that array, not necessarily key `C`. Don't guess past this; if the mapping is ambiguous, ask which key they mean rather than assume.
- **Mix-and-match**: there's no single winning file to point at. Say so, and ask whether they want it built as a new merged variant (loop back to step 2 with a subagent scoped to "combine B's header with C's sidebar") or whether the verdict is just recorded as-is for someone else to build later.

Once you have one resolved key:

1. Record the verdict as a top comment in the HTML: which key/name won, plus **why** — quote or paraphrase the user's own reasoning. If they only gave a pick with no reasoning ("winner is 3"), write the verdict without inventing a rationale — don't fabricate one to fill the line.
2. **Trim the losers out.** The switcher gallery served the flip-through conversation — what gets kept is the winner alone:
   ```sh
   .claude/skills/prototype/trim.py "$SCRATCHPAD/prototype-<feature>.html" <winning-key>
   ```
   This strips every non-winning `Variant` block and the whole switcher (VARIANTS array, `App`, bottom bar) in place, and points the render call straight at the winner. Paramless, hook-fed variants are what make this safe: `trim.py` brace-scans from the function's first `{` (a destructured parameter list breaks the scan), and the surviving variant must render with no switcher passing it props. Confirm the winner still renders from disk, then move the trimmed file to live alongside the feature's spec/design notes — that copy is the only one that persists, as the verdict's visual reference.

## Anti-patterns

- **Variants that differ only in colour or copy.** A tweak, not a prototype — real variants disagree about structure.
- **A shared `<Layout>`.** A shared `<Header>` is fine; the moment the layout is shared the variants can no longer disagree about it, which was the whole point.
- **Wiring variants to real mutations.** Read-only is fine; point anything that must mutate at a stub. The question is what it looks like, not whether the backend works.
- **Promoting prototype code to production.** It was written under prototype constraints — no tests, thin error handling. Rewrite it when you fold it in.
