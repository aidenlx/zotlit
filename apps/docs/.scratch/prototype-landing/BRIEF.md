# Brief: ZotLit landing page prototype — one variant

You build ONE variant of a throwaway landing-page prototype for ZotLit, an Obsidian plugin
that connects Zotero (the reference manager) to Obsidian (the note app). Four other people
build the other variants in parallel. The user flips between variants with a bottom bar and
picks the direction. Variants must disagree about STRUCTURE and visual world, not only
colour.

Folder (all paths absolute):
`/Users/aidenlx/worktrees/zotlit-v2/proto-landing-page/apps/docs/.scratch/prototype-landing/`

## The design question

ZotLit 2.1 and 2.2 changed what the product is. What landing page shows all of it fastest,
through layout, illustration, animation and live demos instead of prose? The user's words:
"show them what we are capable of in a very straightforward way. Be bold. Be creative."

## What every variant must show

Group the features in three tiers (data in `FEATURES` / `TIERS`):

- **Showpieces (fancy):** Citation live preview (type `@`, a suggester appears, the
  citation renders as formatted text in Live Preview, hover shows the Citation Popover) and
  Citations in the graph view (citation edges; papers without a literature note are dimmed
  "Cited Work Nodes").
- **Daily work (practical):** References Sidebar (the note's reference list in a CSL style),
  Cited By Sidebar, Library View (collection tree, quick filters Unread / Annotated / Has note /
  Has PDF, two-line paper cards, Reading Card, drag a paper into a note to cite it), Query
  files and blocks (`.zotquery`: Table / Cards / List / Annotations layouts; edit
  reading-status in a cell; a query block inside a note), PDF reader (read and annotate
  Zotero PDFs in Obsidian; toolbar Highlight / Underline / Note / Text / Image / Ink; every
  mark saves back to Zotero; drag an annotation card into the note), Export with citations
  (Word, any CSL style, copy bibliography), Zotero 10 and group libraries.
- **Power (advanced):** Profiles and the Template Workbench (three panes: Fields | profile
  editor with tabs | note preview that updates as you type), ZotLit Query CLI
  (`obsidian zotlit:query ...` returns JSON; experimental), Agent skills (Claude Code, Codex
  and pi query the library and edit templates, then run `zotlit:template-check`).

Plus: a header (lockup, Docs, Changelog, Community, GitHub with `FACTS.stars`), a primary
call to action "Install ZotLit" → `FACTS.install`, a secondary "Read the docs" →
`FACTS.docs`, the requirement line (`FACTS.obsidian`, `FACTS.zotero`), and a footer.
Mark what is new: "New in 2.2" / "Since 2.1" (from `FEATURES[].since`).

## The file contract

- Read first: the `<head>` of `base.html` (the token block and the import contract), the
  `// --- Shared ---` region of `app.jsx` (all mock data, hooks and brand components), and
  the design craft at
  `/Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/single-file-page/DESIGN.md`
  (read "Avoid the generated look" and "When the treatment is editorial" closely).
- Write exactly one file: `variant-<KEY>.jsx` in the folder. It holds a single paramless
  `function Variant<KEY>() { ... }` plus any helpers it needs. Mock state comes from the
  shared hooks or local `useState`, never from props.
- All variants share ONE script scope. Prefix every top-level name you add with your key:
  `A_Stage`, `A_STEPS`, `aFormat` ... Never redeclare a shared name.
- Do not edit `base.html`, `app.jsx`, another variant, or any file outside the folder. No git.
- In scope with no import: React hooks (`useState`, `useEffect`, `useMemo`, `useRef`,
  `useCallback`, `useLayoutEffect`, `Fragment`, `React`), every lucide icon as `Icons.Name`
  (`<Icons.Quote size={16} />`), motion as `Motion.*` (`Motion.motion.div`,
  `Motion.AnimatePresence`, `Motion.useScroll`, `Motion.useTransform`), and the shared
  module: `useProtoState`, `setProto`, `useLoop`, `useTimeline`, `useTypewriter`,
  `useInView`, `useScrollProgress`, `ZotLitMark`, `Wordmark`, `Lockup`, `SITE`, `FACTS`,
  `FEATURES`, `TIERS`, `ZCOLORS`, `PAPERS`, `PAPER_KEYS`, `READING_STATUSES`, `LIBRARIES`,
  `papersIn`, `NOTES`, `citedBy`, `GRAPH`, `DRAFT`, `parseCitations`, `inText`,
  `CSL_STYLES`, `Bib`, `bibText`, `ANNOTATIONS`, `PDF_TOOLS`, `PROFILE_DOC`,
  `TEMPLATE_FIELDS`, `WORKBENCH_TABS`, `RENDERED_NOTE`, `ZOTQUERY_FILE`, `QUERY_LAYOUTS`,
  `CLI_SESSIONS`, `AGENT_SESSION`, `SHOTS`. Need more mock data? Define it in your file,
  prefixed.
- The variant root is `<div data-v="<KEY>" className="bg-ground text-ink font-body min-h-screen ...">`.
  The token values for your key are already in `base.html`.

## Styling rules

- Colour and type only through the token utilities: `bg-ground`, `bg-surface`, `text-ink`,
  `text-muted`, `border-line`, `text-accent`, `bg-accent`, `text-accent2`, `text-cite`,
  `bg-z-yellow` (and red, green, blue, purple, magenta, orange, gray), `bg-brand-navy`,
  `text-brand-orange`, `font-display`, `font-body`, `font-mono`, `font-sans`,
  `font-wordmark`. Opacity modifiers are fine (`bg-accent/15`). Tailwind's stock palette
  (`bg-slate-900`, `text-gray-500`, `bg-white`, `text-black`) is off limits: it breaks the
  dark scheme. Arbitrary values for size, spacing, rotation are fine.
- Keyframes or extra CSS: render a `<style>{`...`}</style>` inside your root, keyframe names
  prefixed with your key in lower case (`a-pulse`), selectors scoped under `[data-v="<KEY>"]`.
- Brand: use `ZotLitMark` / `Lockup` / `Wordmark`; never redraw the mark. On a dark ground
  pass the dark inks: `ink="#D8E2F0" accent="#F0793F"`.
- Motion: every loop must freeze on a meaningful finished frame when
  `useProtoState().motion` is false (the shared hooks already do; do the same for your own
  timers and for CSS animation, e.g. `animationPlayState`). One orchestrated moment lands
  harder than scattered effects.
- Layout must work at 390 px wide: 16 px side gutters, no horizontal page scroll. A wide
  demo scales down or scrolls inside its own container. Leave 6rem at the bottom of the page
  free for the switcher bar.
- Visible keyboard focus. Interactive things are `<button>` / `<a>`.

## Copy rules

- Readers are academics with research expertise and little programming knowledge. Name
  things as they see them in the app. Explain value as a research outcome.
- Sentence case for headings and labels (Obsidian style). Short sentences. Active voice.
  Simple words.
- Prose is the last resort: show it with layout, illustration, animation and demos. A
  section needs a heading and at most one or two short lines.
- No applause lines and no marketing words ("supercharge", "seamless", "unlock",
  "effortless", "game-changer", "powerful"). No em dashes in your own copy.
- Keep facts true to the shared data. Do not invent features, numbers or quotes.

## Verify in the browser before you return

The browser is the only oracle: one JSX error blanks the whole page for every variant.
Use plain literal commands with absolute paths. The session guard refuses shell variables,
`$(...)`, and any command that contains the word `eval`.

1. `cp <folder>/base.html <folder>/test-<KEY>.html`
2. `python3 /Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/prototype/assemble.py <folder>/test-<KEY>.html <folder>/variant-<KEY>.jsx`
3. Run `agent-browser skills get core` once for the command reference. Use the session
   `proto-landing-<KEY>`. Open `file://<folder>/test-<KEY>.html#<KEY>`, then
   `wait --fn "document.getElementById('root').children.length > 0"`, then `console` and
   `errors`: both must be free of errors.
4. Take screenshots at 1440×900 and at 390×844, at the top and while scrolling through the
   page. Look at each one with the Read tool. Fix what is broken, overlapping, clipped, or
   generic, then reload and look again. Check that a demo animates (screenshot twice, a few
   seconds apart).
5. Finish: keep your best screenshots as `shot-<KEY>-desktop.png` and `shot-<KEY>-mobile.png`
   (top of page), delete `test-<KEY>.html` and other screenshots, close your browser session.

## Return

Only: the path of `variant-<KEY>.jsx`, and 3 to 5 lines: the concept, the section order,
and anything that does not work yet. Keep the JSX out of your reply.
