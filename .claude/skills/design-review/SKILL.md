---
name: design-review
description: Reviews a docs-site UI change against apps/docs/DESIGN.md — runs the design lint rule, renders the touched surfaces, and routes judgement calls to the better-* skills with DESIGN.md's values as the reference. Use before landing any change under apps/docs/src that touches markup or classes.
---

# Design review

The docs site has one design spec, `apps/docs/DESIGN.md`. This skill checks a change against it in three tiers, each catching what the tier above cannot:

1. **The kit** (`apps/docs/src/components/ui/*`) carries every size, so a call site names a variant and nothing else.
2. **The lint check**, the oxlint rule `zotlit-design/workbench-chrome` (`packages/config/oxlint-plugin-design.ts`), catches mechanical drift in Workbench chrome (`src/lib/workbench/*.tsx`, set in `apps/docs/oxlint.config.ts`): a raw popover, a size or spacing at a call site, a physical direction class, an arbitrary text size, uppercase chrome. The other surfaces carry their rules in tiers 1 and 3.
3. **The spec's prose** carries judgement calls: grouping, hierarchy, which surface speaks which voice. Those go to the `better-*` skills with DESIGN.md's values in hand.

A correction lands in the narrowest tier that can hold it for good. A size that repeats at two call sites becomes a kit variant and a line in DESIGN.md, and the check learns to reject the call-site spelling. A one-off class is the outcome to avoid.

## Steps

1. **Resolve the scope** the way `interface-review` does: the branch ahead of the merge base plus the working tree, or the target the user names. Keep files under `apps/docs/src`.

2. **Read the spec for the surface.** DESIGN.md is organised per surface (`### Template Workbench`, `### Landing`, `### Learn`, docs chrome); the Workbench's own guide is `apps/docs/WORKBENCH-DESIGN.md`. Read the section for every surface the change renders in, and "The label voice" whenever the change adds a label.

3. **Run the check** on the changed files, with paths relative to `apps/docs`. The lint config is type-aware, so in a new worktree run `pnpm exec turbo run typecheck --filter=@zotlit/docs` once first: it generates the `@/paraglide` modules the files import.

   ```bash
   pnpm --filter @zotlit/docs exec oxlint <changed files under src/>
   ```

   Each `zotlit-design/workbench-chrome` error names `file:line` and the rule. Fix the cause in the kit or the spec; extend the rule when a new rule earned its place in DESIGN.md. Other diagnostics are this review's only when the change introduced them (`git blame` the line). When no changed file is a non-test `.tsx` file directly under `src/lib/workbench/`, report the check as covering none of the touched surfaces and carry on.

4. **Render the touched surfaces.** Start the dev server and capture each touched surface at 1440 px and 640 px with agent-browser (conventions: `docs/agents/agent-browser.md`; export `NO_PROXY='localhost,127.0.0.1'`). Measure rather than eyeball: read control heights and font sizes from the DOM and compare them with the spec's numbers.

   ```bash
   agent-browser eval "JSON.stringify([...document.querySelectorAll('button')].map(b=>[b.textContent.trim().slice(0,24), Math.round(b.getBoundingClientRect().height), getComputedStyle(b).fontSize]))"
   ```

   A native `<select>` with focus stalls screenshot capture; blur it, or capture before opening it.

   The Default profile locks the Match tab. To review Match, write a profile with its own id — `node .claude/skills/design-review/review-profile.mjs .scratch/review-profile.md` — and load it through **Open profile → Open profile from file**.

5. **Route the judgement calls.** Hand the rendered surfaces to `better-layout`, `better-typography`, and `better-ui` with the spec's values as the density system, so the reviewer applies 32 px / 12 px / 4-8-12-16 rather than its generic defaults. `better-interface` consolidates the verdict.

6. **Report** in the `better-*` table format, one row per root cause with every location. Add a `Tier` column: `kit`, `check`, or `spec`, naming where the fix belongs. End with `Block` while any `HIGH` or any `workbench-chrome` error remains, `Approve` otherwise. State every viewport and state you did not render as `Not verified`.

## Extending the system

When a review finds a rule worth keeping:

- Put the value in the kit variant first (`button.tsx`, `input.tsx`, `native-select.tsx`).
- Write the decision into the matching DESIGN.md section as the target state, in one or two sentences.
- Teach `workbench-chrome` in `packages/config/oxlint-plugin-design.ts` to reject the call-site spelling of the same value, with a case in `oxlint-plugin-design.test.ts`.
- Leave call sites naming only variants, layout classes (`flex-1`, `ms-auto`, `mt-2`), and state classes (`aria-pressed:*`, `data-pressed:*`).
