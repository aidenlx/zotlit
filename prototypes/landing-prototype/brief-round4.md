# Round 4 brief: a creative first screen for the ZotLit landing page

## The product and the reader
ZotLit is an Obsidian plugin that brings a researcher's Zotero library into Obsidian.
The reader is a non-technical academic (PhD student, postdoc, lecturer): tired, short on
time, expert in research, not in software. They keep papers in Zotero and notes in
Obsidian, or are thinking about it. They have never heard of ZotLit.

## The question this round answers
What does the FIRST SCREEN (no scrolling) look like, so that this stranger understands
what ZotLit does in a few seconds AND finds it attractive enough to keep going?
Round 3 was rejected as "too plain": a headline, a lede, buttons and grey placeholder
boxes. This round must be creative and visually striking, with one real aesthetic
risk, while staying clear. Clarity still wins over cleverness: in 5 seconds a stranger
must be able to say "it puts my Zotero papers, highlights and citations into Obsidian".

## Copy (owner's decisions)
- Keep the "research desk" headline family: "A research desk for Zotero in Obsidian."
  You may set it creatively (marks, highlights, split lines), but keep its words.
- Lede: "Find, read, annotate, cite and export your Zotero papers, right beside the notes you write."
- Buttons: "Install ZotLit" (primary) and "Start the tutorial".
- Facts you may use (all true): FACTS in the shell (`FACTS.jobs` has the 8 jobs and their
  one-line outcomes, `FACTS.privacy`, `FACTS.license`, `FACTS.requirements`, `FACTS.bbt`).
  More true facts: with Zotero 10, highlights and comments made in Obsidian save back to
  Zotero; Zotero can stay closed; group libraries work; citations appear in the style you
  pick (APA etc.); export to Word with a reference list; literature notes with the
  paper's details and highlights. Invent no other features, no numbers, no testimonials,
  no prices, no user counts.
- Real sample data you may enact (from the real lesson vault):
  - Sandve GK, Nekrutenko A, Taylor J, Hovig E (2013) "Ten Simple Rules for Reproducible
    Computational Research", PLOS Computational Biology. Citekey `sandve2013`.
    Highlights: "As a minimal requirement, you should at least be able to reproduce the
    results yourself." (yellow, tag reproducibility, comment "The bar for every analysis in
    my methods chapter."); "good habits of reproducibility may actually turn out to be a
    time-saver in the longer run." (green, tag argument); "a failure to take notes may make
    exact reproduction essentially impossible." (red underline, tag pitfall).
  - Munafò, Nosek, Bishop et al. (2017) "A manifesto for reproducible science", Nature Human Behaviour.
  - Rougier et al. (2014) "Ten Simple Rules for Better Figures", PLOS Computational Biology.
  - Ioannidis (2005) "Why Most Published Research Findings Are False", PLOS Medicine.
  - A draft "Chapter 3 – Presenting the results" with sections "3.1 Why the figures come
    first", "3.2 How much to trust a single result", "3.3 Keeping each figure reproducible".
  - APA in-text: (Sandve et al., 2013), (Rougier et al., 2014), (Ioannidis, 2005).
- Zotero's real highlight colours (use as inline hex, they are product-true):
  yellow #ffd400, red #ff6666, green #5fb236, blue #2ea8e5, purple #a28ae5.

## Recordings
Real recordings will be made later for each case. Where your design needs a product
screen recording, use `<H_Rec brief="what the clip must show" ratio="16 / 10" />`
(defined in the shell; `compact` prop for small ones). You are ENCOURAGED instead to
enact the product moment in HTML/CSS (a typed `[@` citation, a highlight sweep, a note
assembling): an enactment is a designed illustration, and it is what makes the screen
attractive. Keep any enactment faithful to how the product behaves (above facts).

## Technical contract
- Shell: /Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell/apps/docs/.scratch/landing-proto/prototype-landing.html
  Read its `<head>` and its `// --- Shared ---` and `// --- Hero variants (round 3) ---`
  regions. Available in scope: React (`React.useRef`, `React.useLayoutEffect` …),
  `useState`, `useEffect`, `useMemo`, lucide `Search`, `ChevronDown`, `FACTS`, `H_Rec`,
  `C_Button` (props href, filled, children), `C_LEARN`. You may NOT add imports.
- Tokens (use the utilities): bg-ground, bg-card, bg-tint, text-ink, text-muted,
  border-line, text-accent / bg-accent / border-accent, text-accent-ink; fonts
  font-display (Gelasio, a serif), font-body (Inter), font-mono (IBM Plex Mono). Both
  light and dark schemes come from the tokens; stock Tailwind colours are banned except
  the Zotero highlight hexes above (inline style). Make sure the design also reads in
  dark mode (prefers-color-scheme).
- Craft: /Users/aidenlx/.claude-multi/accounts/acct-20261016-8555e5b0948945aa9a8fcdfcb46d7580/skills/single-file-page/DESIGN.md
  (read "When the treatment is editorial").
- Fit: the whole hero (headline, lede, both buttons, and the visual's key moment) must sit
  above the fold at 1440x900 (the site header above you takes ~70px). At 390x844 the
  headline, lede and buttons must be above the fold, the visual may start below. No
  horizontal scroll at any width (use overflow-hidden on decorative layers).
- Motion: one orchestrated moment beats scattered effects. Loop or settle calmly. Honour
  `prefers-reduced-motion: reduce` (show the final state). You may add a `<style>` element
  inside your component for keyframes; prefix keyframe and class names with your key.
- Accessibility: decorative layers aria-hidden; the headline is the h1; buttons are links.
- Output: ONE file at the path you are given, containing `function H_<KEY>() {...}` (a
  `<section>` that renders the whole hero, starting below the site header) plus helpers
  prefixed `<KEY>_`. No imports or exports. Do not edit the shell.
- Before you return, check that the file compiles: run
  `node -e "require('/Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell/node_modules/.pnpm/node_modules/esbuild').transformSync(require('fs').readFileSync(process.argv[1],'utf8'),{loader:'jsx'})" <your file>`
  (exit 0 means it compiles).
- Then render it: run `python3 /Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell/apps/docs/.scratch/landing-proto/preview.py <KEY> <your file>`,
  which writes `preview-<KEY>.html` with your hero in place, and screenshot it with
  agent-browser (session name `r4-<KEY>`) at `http://localhost:4840/preview-<KEY>.html`
  at 1440x900 and 390x844. Look at the screenshots and fix what is off. Close the session.
- Return only the file path and two lines: the concept, and where the aesthetic risk is.
