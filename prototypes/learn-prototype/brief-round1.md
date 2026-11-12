# Tutorial prototype, round 1: brief for one variant

You build ONE variant of a throwaway UI prototype. Four other agents build the other four in
parallel. The orchestrator splices your file into one HTML page with a variant switcher.

## The question

What shape should the ZotLit tutorial take: the course hub (`/learn`) plus a lesson?

**ZotLit** is an Obsidian plugin that brings your Zotero library into Obsidian. You can browse papers, read and annotate PDFs, get literature notes, cite as you write, export to Word, and build literature-review tables.

**The reader** is a non-technical academic who **already uses Zotero and Obsidian**. They are tired and short on time. They open the tutorial to find out one thing: does ZotLit remove the friction between the two apps?
- Do not explain what Zotero or Obsidian are.
- Do not explain how to use Obsidian in general.
- Show them their own routine getting shorter, and get them to a visible win fast.

**The owner's verdict on today's tutorial** is that it is poorly designed and was not made with this reader in mind. Today:
- **Hub:** six cards with feature titles, such as "Connect Zotero to Obsidian and write a literature note". Each card carries a line like "LESSON 1 · ABOUT 10 MINUTES · 6 STEPS" and "You end with: …".
- **Lesson cover:** an abstract box map ("Local Zotero library → Obsidian vault", with bullet lists), a privacy paragraph, a "You need" version table, and a Start button.
- **Steps:** one step per screen. Each shows a full-window screenshot too small to read, the action, a green "check" box, and the buttons "I see it. Next" and "I see something else".

**Reference: nextjs.org/learn.** The orchestrator looked at it. The hub has an outcome headline ("Start building with Next.js"), a live mock of the finished app, four outcome bullets, and a numbered chapter-card grid. A chapter page has:
- a big circled chapter number beside the title;
- a one-line opener that ties back to the last chapter;
- an "In this chapter… Here are the topics we'll cover" box with 2–3 icon rows;
- short sections, each "do this → save → your page should now look like this" with a screenshot;
- a curiosity-gap "why", such as "But wait a second, … where did the styles come from?";
- a centred "It's time to take a quiz!" multiple-choice check;
- a floating pill that shows the current chapter;
- at the end, a big number circle with a check mark, "You've Completed Chapter 2", one "Well done!" line, and a "Next Up" card that teases the concrete next build, with a "Start Chapter 3" button.

The tone gives explicit permission not to understand yet, such as "Don't worry if…".

## Your file and contract

- Write exactly one file: `apps/docs/.scratch/learn-proto/variant-<KEY>.jsx` (absolute root: `/Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell`).
- It holds one paramless `function Variant<KEY>() { … }`. Any helpers go above it as top-level functions or consts, every name prefixed `<KEY>_` so the variants do not collide.
- **No imports.** These are already in scope from the page: `React`, `useState`, `useEffect`, `useRef`, `useMemo`, `useSyncExternalStore`, `Icons` (lucide-react, used as `<Icons.Check size={16} />`), and the shared section below.
- Read the page's shared section for its exact API: `apps/docs/.scratch/learn-proto/shell.html`, between `// --- Shared ---` and `// --- Shared END ---`. In summary:
  - `LESSONS`: the six real lessons with all their steps (action, check, fixes, alt), `minutes`, `lede`, `needs`, and `end`. Look at `lessons.json` beside it to see the data. Render step strings with `<Rich text={...} />`.
  - `FACTS`: sourced product facts, plus `FACTS.today[n]`, the reader's own manual routine for lesson n. Treat those lines as draft copy.
  - `<Media lesson={l} n={k} play crop={[x, y, w]} />`: a real recording of step k, or its final frame when `play` is off.
    - `crop` zooms into a region of the 1440×860 Obsidian window. x and y are the top-left corner as a fraction, and w is the width fraction shown. The frame keeps the 1440:860 ratio.
    - It already handles reduced motion and has a pause button.
    - Look at the stills in `apps/docs/.scratch/learn-proto/frames/` (`<media>-step-<n>.jpg`) to choose crops. Use the Read tool on a few of them. Crops are how a step becomes readable at tutorial width.
  - The store: `useProto()` returns `{ view: "hub"|"lesson", lesson, step, done }`. The helpers are `openHub()`, `openLesson(num, step)`, `finishLesson(num)` and `setProto(patch)`.
    - `step` is 0 for the lesson's opening, 1..N for the steps, and N+1 for its end.
    - Keep all navigation state in this store, so the switcher's scenario buttons ("Lesson 1, step 3", "Back after lesson 1") work in your variant.
    - If your shape scrolls through all steps on one page, scroll to `#<KEY>-step-<step>` when `step` changes, and update `step` as the reader moves.
- Your variant must render BOTH views from the store: the hub, and a lesson with its opening, every step and its end, for any of the six lessons, not only lesson 1.
- Style only with Tailwind utilities over the page tokens: `bg-ground`, `bg-card`, `text-ink`, `text-muted`, `border-line`, `bg-accent`, `text-accent-ink`, `bg-tint`, `text-ok`, `bg-ok-tint`, `font-display` (Gelasio), `font-body` (Inter) and `font-mono` (IBM Plex Mono). Arbitrary values are fine. Write no `<style>` blocks.

## Build rules (these are failures if missed)

- **Widths:** it must work at 390 px (phone), at 700 px, and at 1440 px. 700 px is the real case: "keep Obsidian open beside this page" means a half-screen window. Nothing may be clipped or overlapped, and the page must have no horizontal scroll.
- **Keyboard:** every control is a real `<button>` or `<a>`, reachable by keyboard, with a visible focus ring (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`). Icon-only controls get an `aria-label` that names the action. Do not bind the Left and Right arrow keys, because the switcher owns them.
- **Motion:** use `<Media>` for clips. Put any animation of your own behind `motion-safe:`. A state change must not be carried by motion alone.
- **State and colour:** "done" or "current" is shown with an icon or text as well as colour.
- **Type:**
  - body text at least `text-base`, with `leading-relaxed` or about 1.5 on paragraphs;
  - headings `leading-tight` to about 1.2, with `text-balance` on headings;
  - prose capped near 65ch;
  - sentence case everywhere;
  - mono labels small and uppercase with `tracking-wider`;
  - curly quotes and the … character in new copy.
- **Headings:** one `h1` per view, and heading levels descend in order.

## Copy rules

- Step instructions, checks and fixes come from `LESSONS`. Use them as they are, or shorten them; do not invent product behaviour.
- New lines (headlines, framing, "why") are drafts. Keep them short and plain. Address the reader as "you". Write no em dashes, no "not X, it's Y", and no hype words ("seamless", "powerful", "supercharge", "unlock").
- Never claim that highlights "sync" or save back to Zotero as a selling point. Lesson 2 does this as a step, and that is fine to show as a step.
- Make no claims about other plugins. "Today you…" lines describe the reader's own manual routine (see `FACTS.today`).
- The reader knows Obsidian. "Install ZotLit from Community plugins" is enough. Skip the click-by-click route to Community plugins unless a fix needs it.

## Taste

The owner rejected an earlier landing round as "too plain". This is the docs site's editorial "Journal" design: Gelasio display type, mono labels, warm paper ground, a burnt-orange accent, and quiet 1 px rings (`shadow-[0_0_0_1px_var(--line)]`) instead of heavy borders. Make it look made by a good editorial designer, with real product recordings as the hero material. Use real crops of the recordings rather than drawn placeholders.

## Report

When the file is written, reply with only the path and a three-line summary: the shape, where the payoff sits, and how the reader checks their screen. Do not paste the JSX.
