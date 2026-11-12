# Brief: the new /learn tutorial (course page + checklist lesson)

**Worktree:** `/Users/aidenlx/worktrees/zotlit-v2/docs-learn-checklist`, branch `docs/learn-checklist` (made from `docs/site-v3`). Work only there.

## Who it is for, and what the owner decided

**Reader:** a non-technical academic who already uses Zotero and Obsidian. They are tired and short on time, and they come to see whether ZotLit removes a specific friction between the two apps. Today's tutorial was judged "poorly designed and not considered from our target users".

**Prototype round 1 decided the shape.** The visual and behavioural reference is the prototype in another worktree, read-only:
- Folder: `/Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell/apps/docs/.scratch/learn-proto/`.
- To see it, serve the folder (`python3 -m http.server -d <that folder> 4842`) and open `prototype-learn.html#D` and `#B`.
- Variant **D** ("Pick a chore", `variant-D.jsx`) is the base for both the course page and the lesson.
- From variant **B** (`variant-B.jsx`), take only the lesson opener: "What you do today" beside "What you'll do instead", **with no counts or numbers**.
- Next.js-style quizzes, floating pills and the video player (variants A and C) are out.
- E's manual zoom switch is out. The zoom is planned into the recordings themselves, so the page shows **no zoom control**, only pause and play.

## What to build

### Course page (`/learn`)
- An H1 and a short lede. The draft is in the spirit of "What slows you down between Zotero and Obsidian?".
- **Start here:** lesson 1, as a strip or card, framed as connecting once, which every other lesson needs.
- **Chore cards** for lessons 2–6. Each card has:
  - the chore in the reader's words, for example "I copy highlights into my notes by hand";
  - a "Today you…" line;
  - the lesson's result picture (its last step's poster);
  - the minutes.
- **Progress:** done lessons show a check icon and the text "Done". The Start / Continue logic stays, using the existing localStorage progress.

### Lesson (`/learn/$lesson`)
- **One page that holds every step.** It is prerendered, and all the text is in the HTML for search. The lesson title stays the H1, the SEO title.
- **Opener:**
  - the H1;
  - the today / instead lists;
  - the result, shown as the last step's clip (muted loop; with reduced motion, the poster);
  - what you need, as one line.
- **Checklist:**
  - A sticky header shows "N of M done" as text, with a segmented bar.
  - Each step is a row with a real checkbox control and the step title.
  - The open row shows the action (the MDX body), the step's clip, an "In Obsidian you should see" box (the `<Check>`), and a "Not what you see?" disclosure that holds the `<Fix>` items.
  - Ticking a row collapses it, shows a check and the quiet title, and opens the next row. The reader can re-open any row.
  - Ticks persist per step in localStorage. Extend `lesson-state.ts`.
- **Deep links:** `/learn/<slug>#<n>` must open row n. Other pages and the redirect table link that way.
- **End:** "All N done", one line on what ZotLit now does (from `end`), and links to two other chores (lesson 1 counts as their prerequisite).
- **Width:** design first for a **700 px** half-screen window beside Obsidian, then check 390 and 1440. D's sticky media panel at very wide widths is optional; keep it only if it earns its place.

### Media
- Clips stay `public/img/learn/<media>/step-<n>.{webm,mp4}`, 1440×860.
- A recorder change on another branch adds **`step-<n>.poster.webp`**, the clip's final frame zoomed onto the result.
- Use the poster when it exists and fall back to `step-<n>.webp` when it does not. `src/lib/learn-media.ts` scans the folder, so teach it the poster. Today no poster files exist, so the fallback must work.
- Only the open row's clip loads and plays. It pauses when out of view, and with reduced motion it rests on its poster until the reader plays it. Reuse what `step-picture.tsx` does.

### Content and copy
- Add frontmatter fields to `learnSchema` in `content.config.ts` for:
  - the chore phrase;
  - the today list;
  - the instead line.

  Fill them in all six lessons, and update `src/lib/lessons.test.ts`.
- Every new or changed English string is a **draft**. After you finish, the orchestrator has a Gemini writer rewrite the copy. So list every new or changed string, its key or frontmatter path, and where it shows, in `apps/docs/.scratch/learn-copy/copy-sheet.md` in your worktree.
- UI strings go in `messages/en.json` as `docs_learn_*`. Run `/inlang-i18n` and `/i18n-ui-text` before editing messages. Check how a missing zh-CN key behaves and handle it the way the repo already does.
- Never claim highlights "sync" or save back to Zotero as a selling point. Lesson 2's end title says "Highlights synced across PDF, note, and Zotero"; put a neutral draft in the copy sheet instead.
- Remove what your change orphans: the cover map, the "You need" table, the "I see it. Next" / "I see something else" buttons, and their messages. This follows the repo's surgical-change rule.

### House rules
- Read these first:
  - `apps/docs/AGENTS.md` and `apps/docs/DESIGN.md` (the tokens, the four faces, label voice);
  - the existing `src/routes/learn/*` and `src/components/learn/*`, `content.config.ts`, `src/lib/learn-media.ts`, `src/lib/lessons.test.ts`;
  - the root `AGENTS.md`.
- Style with the site's `fd-*` tokens and DESIGN.md values. The prototype's tokens map onto them.
- Every control is a real button, link or input, reachable by keyboard, with a visible focus ring. State uses an icon or text as well as colour. Any animation goes behind `motion-safe`. There is one h1, and the headings descend in order.
- Copy for agents: write comments as one line each, affirmative.

## Checks
- `pnpm exec turbo run typecheck --filter=@zotlit/docs`
- `pnpm exec turbo run test --filter=@zotlit/docs`
- `pnpm lint`, `pnpm format`
- `pnpm exec turbo run build --filter=@zotlit/docs`
- Render with `agent-browser` against your own dev server on port **4832** (not 4831): the course page (first visit, and after lesson 1), lesson 1 at its opening, at `#3` and at the end, and lesson 4 with the portrait Word still. Do this at 390, 700 and 1440 px, with no horizontal scroll. Read the screenshots yourself.
- Run `/design-review` on the change and fix what it finds.

## Git
- Commit on `docs/learn-checklist` with conventional messages, with no AI attribution.
- Push: `git -C <worktree> lfs push origin docs/learn-checklist`, then `git -C <worktree> push --no-verify -u origin docs/learn-checklist`. Never push to main or next, and never force-push.
- Run single `git -C <worktree> …` commands.

## Report
Write the report in ASD-STE100 Simplified Technical English and keep it short:
- the commits;
- what you checked and at which widths;
- the copy-sheet path;
- any decision you made that the owner should see.
