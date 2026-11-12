# Build brief: the new ZotLit landing page

## Goal
Rebuild the landing page (`apps/docs/src/routes/_home/index.tsx` → `LandingPage` in
`apps/docs/src/components/landing/`) to match the approved prototype:
`apps/docs/.scratch/landing-proto/prototype-landing.html` (single-file React; read its top
comment block for every decision the owner made, round by round). Open it at
http://localhost:4840/prototype-landing.html (a static server is running on 4840).

The page, top to bottom:
1. **Hero: the merged research desk** — `function H_MX` and its `MX_*` helpers in the
   prototype. Headline "A research desk for Zotero in Obsidian." (yellow marker on
   "research desk"), eyebrow, lede "Browse your Zotero library in an Obsidian tab, and turn
   any collection into a live table you can sort, filter and rate.", buttons "Install ZotLit"
   and "Start the tutorial", requirements line. Six desk objects with tape labels:
   "Browse your library" (Library View sheet), "A live literature table"
   (Reproducibility.zotquery), "Read and annotate" (PDF page), "Take literature notes"
   (index card), "Cite while you write" (draft + picker), "Export and submit" (references).
   Full desk from 1280px; below it the fanned stack. Drop-in order, pointer parallax, soft
   clearing, reduced motion = final state.
2. **"Compare your papers side by side."** — `function SQ_Section` and its `SQS_*` helpers:
   eyebrow "Before you write", the lede, "Learn in the tutorial →"
   (`/learn/literature-review-table-from-zotero`), the enacted demo (collection → Save as query
   file → fixed column tracks filling left to right → sort by year → rating typed for the two
   papers that have a note; "Create" and "No note" for the two that do not), the 5-beat
   caption trail, and the three points "What Zotero knows." / "What you decided." / "What you
   have not read yet.". Starts when scrolled into view.
3. **Workflow** — `VariantC`'s "From Zotero to finished chapter." section with the five
   zig-zag steps (`C_STEPS`): each step's screen is a RECORDING (see "Recordings").
4. **Trust row** (`C_Trust`): three items, one separator (the section's top border only).
5. **Closing CTA** band and then the site's existing footer.
The prototype's own header and footer are stand-ins: keep the site's real home header and
`footer` prop. The prototype's switcher bar and red fold line are prototype-only: drop them.

## Rules
- Repo instructions: root `AGENTS.md`, `apps/docs/AGENTS.md`, and `apps/docs/DESIGN.md`
  (tokens, the type system, label voice, CSS architecture). Read DESIGN.md before styling.
  Map the prototype's tokens onto the site's: ground → `fd-background`, card → `fd-card`,
  ink → `fd-foreground`, muted → `fd-muted-foreground`, line → `fd-border`,
  accent → `fd-primary`; font-display → the site's Gelasio serif utility, font-body → Inter
  (the default), font-mono → IBM Plex Mono. Light and dark both. Zotero highlight hexes and
  Obsidian's purple stay literal inside the enacted app windows only. Update DESIGN.md's
  Landing section to describe the new page (it currently describes the desk + contents
  column).
- Copy: every user-facing string is a message in `messages/en.json` (`docs_home_*` keys)
  read through `m.*` (run the `paraglide-i18n` and `i18n-ui-text` skills). Sample research
  data inside the enacted windows (paper titles, authors, citekeys, the chapter text,
  references) may stay as data constants in code, not messages. Copy is final as in the
  prototype; never claim that highlights save or write back to Zotero.
- Remove what the new page orphans: the old desk, contents column, job sections, setup,
  replicas and their messages, only where nothing else reads them (check with `rg`; knip in
  `pnpm lint` fails on unused exports). Keep the scroll-performance lessons from commit
  `edd6a51c6`: no per-frame writes of inherited custom properties on large subtrees; read
  layout before you write; animate transform/opacity.
- The page is prerendered: render deterministic markup with no `window` access during render;
  the static HTML must show the final, readable state (no content that only JS reveals).
  Start animations after mount, only with motion allowed.
- Performance: the landing should stay light; avoid shipping large per-frame React updates.
- SEO: keep the route's head (title/description) unless DESIGN.md or the copy says otherwise;
  the H1 is the hero headline.

## Recordings (made in parallel by another agent, merged later)
The five workflow steps use clips at these paths (do not create them; reference them):
`/img/landing/<case>.webp` (poster, 1600x1000), `/img/landing/<case>.mp4`,
`/img/landing/<case>.webm`, all 16:10. Cases, in step order: `find`, `read`, `note`, `cite`,
`word` (`word` may ship a still only: render a still when no clip exists — keep one small map
of which cases have a clip). Render each in a 16:10 frame (aspect-ratio 16 / 10, object-fit
cover), `muted autoplay loop playsInline`, `preload="none"` or lazy start when in view, the
poster as the still for reduced motion, and the alt text from the prototype's MEDIA alts
(as messages; drop the "saves to Zotero" wording).

## Done when
- The page at http://localhost:4831/ (the dev server is running; do not restart it unless it
  died — if you must, stop it first) matches the prototype at 1440x900, 1280x800, 1024x768
  and 390x844, light and dark, with no horizontal scroll and no console errors (check with
  agent-browser, session `landing-build`, close it after). Missing recordings show as broken
  posters until the merge; that is expected.
- `pnpm exec turbo run typecheck --filter=@zotlit/docs`, the docs tests
  (`rm -rf node_modules/.vitest-cache` first, then `pnpm exec turbo run test --filter=@zotlit/docs`),
  `pnpm lint`, `pnpm format` and `pnpm exec turbo run build --filter=@zotlit/docs` pass.
- Run the `design-review` skill on the changed surfaces and fix what it finds.
- Commit on the current branch (`docs/site-v3`) in this worktree, in logical commits, with
  messages about the change and its validation (no AI attribution). Run every git command as
  a single `git -C /Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell …` command. Do
  not push. Do not touch `apps/docs/public/img/landing/`.
- Report: what changed (files), what you removed, checks run with results, and anything you
  could not match.
