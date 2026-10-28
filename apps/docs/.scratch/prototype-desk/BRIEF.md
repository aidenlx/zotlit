# Brief: ZotLit landing page prototype, round 2 ("An integrated research desk")

You build ONE variant of a throwaway landing-page prototype for ZotLit, an Obsidian plugin
that brings a researcher's Zotero library (the reference manager) into Obsidian (the note
app). Four other people build the other variants in parallel. The user flips between the
variants with a bottom bar and picks a direction. Variants must disagree about STRUCTURE and
visual world, not only colour.

Folder (all paths absolute):
`/Users/aidenlx/worktrees/zotlit-v2/proto-landing-page/apps/docs/.scratch/prototype-desk/`

## The design question

ZotLit's main message is now: **"An integrated research desk for Obsidian."** One place
where an academic finds, reads, annotates, takes notes on, writes with, connects and exports
their Zotero sources. The user's words: "let users finish academic work", "BE USEFUL, while
attractive", "show what we are capable of in a very straightforward way", "show the features
with layouts, illustrations, animation and demos instead of pure prose", "be bold, be
creative". And: "the page should be clean. Not too many distractions that are difficult for
non-technical academic users to understand, and that could fail to deliver our features."

Round 1 (set aside) tried: a time-of-day story over screenshots, a dense bento grid of
looping demos, a dark citation-map hero, a Source/Live Preview page toggle, and the page as
a typeset preprint. Do not repeat those. Do not build a dense grid where many demos loop at
once.

## The readers

Academics: research expertise, little programming knowledge. They know "reference list",
"citation style", "highlight", "literature note", "reading list", "collection", "PDF",
"Word". They do not know "CLI", "JSON", "YAML", "query", "Pandoc", "CSL", "template engine".
Name things as the app names them (feature names in `FEATURES` are exact), and say what each
does for their research in plain words. Technical words appear only inside the advanced
part, and there each one gets a plain explanation next to it.

## The story (data in the `// --- Shared ---` region of `base.html`)

- `JOBS`: eight research jobs in the order a researcher meets them: Bring your library ·
  Find a paper · Read and annotate · Take literature notes · Cite while you write · See how
  your sources connect · Export and submit · Make it yours. Each has `name`, `outcome` (one
  line), `desk` (the physical-desk object that stands for it) and `icon` (a lucide name).
- `FEATURES`: every feature, 40 of them, with `job`, `since` ("2.0" = the basics, "2.1",
  "2.2"), `tier` ("signature" | "daily" | "advanced"), `lead: true` on the one feature that
  leads its job, `name` (exact), `line` (one plain sentence), `href` (its docs page),
  optional `companion` / `experimental`. Helpers: `featuresOf(job)`, `leadOf(job)`,
  `feature(id)`, `sinceLabel(f)` ("New in 2.2" / "Since 2.1" / null for the basics).
- `TIERS`: the user's own three-level view: signature (the showpieces), daily (practical),
  advanced (power users).
- `FACTS` (version, stars, requirements, platforms, licence, privacy line, every link),
  `INSTALL_STEPS` (a real three-step sequence), `ADDONS` (ZotLit Companion, Better BibTeX,
  both optional).

### Coverage rules (every variant)

1. The hero states the thesis. Use the words "An integrated research desk for Obsidian"
   as the H1 (line breaks and emphasis are yours), with one supporting line in research
   terms, the primary action **Install ZotLit** → `FACTS.install`, a secondary **Read the
   docs** → `FACTS.docs` (or "Start the tutorial" → `FACTS.firstNote`), and the requirement
   line (`FACTS.obsidian`, `FACTS.zotero`, `FACTS.platforms`).
2. All eight jobs appear, in `JOBS` order (a variant whose structure is not linear, such as
   a map of desk objects, still offers them in this order to keyboard and screen readers).
3. Every job's `lead` feature gets a real demo: drawn UI that animates or that the reader can
   operate. The **signature** features must be unmissable: citations in Live Preview
   (`livePreview`), the Citation Popover (`popover`), citations in the graph view (`graph`).
   The practical ones need visible demos: References Sidebar (`references`), Library View
   (`library`) with its Reading Card, Query files and blocks (`query`, with reading status),
   PDF reader (`pdf`, with annotating). The advanced ones get a small demo each: Template
   Workbench (`workbench`), ZotLit Query CLI (`queryCli`), AI assistant skills (`agents`).
4. Every other feature appears at least by `name` and `line`, in a quiet list under its
   job, so the page covers the whole product. The basics ("2.0") carry no badge; newer
   features carry `sinceLabel(f)`. Mark `experimental` and `companion` features as such.
5. Somewhere the reader learns the practical facts: three install steps, what they need
   (Obsidian, Zotero, desktop), that the Companion and Better BibTeX are optional,
   `FACTS.privacy`, `FACTS.license`. Plus a header (lockup, Docs, Changelog, Community,
   GitHub with `FACTS.stars`) and a footer.

### Clean rules (the user asked for this twice)

- One focal point per screen. Generous space. A section has a heading and at most one or
  two short lines of prose; the demo does the explaining.
- At most ONE looping animation visible at a time. Start a demo when it scrolls into view
  (`useInView`) and stop it when it leaves.
- No tickers, marquees, particles, noise textures, decorative blobs, glow, or gradients
  for decoration. No emoji. No fake numbers or invented quotes.
- Numbering (01, 02...) only for a real sequence (the eight jobs as a workflow, the install
  steps, a tour's steps).
- Demos use the shared mock library (`PAPERS`, `ANNOTATIONS`, `NOTES`, `DRAFT`, `GRAPH`...)
  so the same papers recur across the page. That continuity is the "integrated" message:
  the paper you find is the one you read, quote, cite and see in the graph.

## The five variants (so you know what the others do; build only yours)

- **A · Exploded view.** An axonometric technical drawing of the desk. Hero: the desk's
  layers (Zotero library at the base, then Library View, PDF reader, literature note,
  manuscript with citations, graph on top) float apart as thin isometric panels with
  leader-line callouts, and lock into one flat Obsidian window as you scroll (one
  orchestrated moment). Then one section per job: the layer face-on as a working demo, with
  a "parts list" (bill of materials) of that job's features beside it. The advanced
  features are the machine room "under the desk". Install steps as assembly instructions.
- **B · Today's task.** A calm, helpful reference desk. Under the H1, the question "What do
  you need to do today?" and eight plain-language task chips ("Read and annotate a PDF",
  "Write a chapter with citations", ...), one per job. The chosen task plays on ONE demo
  stage: three numbered steps on one side, the drawn UI acting them out on the other, kept in
  sync. It cycles on its own until the reader picks a task. Then a clean index, "Everything
  on the desk": every feature by job, as a typographic table, not cards. Then install.
- **C · Before and after.** Bold, graphic, poster-like. Hero: six scattered generic windows
  (a reference manager, a PDF viewer, a word processor, a notes app, a spreadsheet reading
  list, sticky notes) with a "6 windows" count fold into one ZotLit desk, "1 desk". Then each
  job is a row: the old way on the left (grey, a short list of tedious manual steps, a step
  count) and the ZotLit way on the right (one live demo, its step count). Generic apps only:
  no real product names or logos in the "before". Advanced features close the page as
  "after only" rows.
- **D · The desk from above.** A flat, top-down illustration of a real desk, drawn in SVG:
  filing cabinet (Bring your library), bookshelf (Find), open paper with a highlighter
  (Read), notebook (Notes), manuscript (Cite), pinboard with string (Connect), out tray
  (Export), toolbox and laptop (Make it yours). Hover shows a label; select an object to open
  a panel with that job's lead demo and its feature list. One quiet idle animation at most.
  Below the desk, the same objects as a plain list for keyboard and mobile readers.
- **E · Take the tour.** The hero IS the product: a large, interactive Obsidian window
  (dark app theme) with ribbon, Library View, editor tabs and right sidebar. A tour card
  ("Step 2 of 8 · Read and annotate", Back / Next, progress) drives the window through all
  eight jobs, with a coach-mark ring on the UI that matters in each step; the reader can also
  click inside the window. Then a compact index of everything in the tour and more, and
  install.

## The file contract

- Read first: the `<head>` of `base.html` (the design plan comment, the token block for
  your key, and the import contract), the WHOLE `// --- Shared ---` region of `base.html`
  (all mock data, hooks and brand components), and the design craft at
  `/Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/single-file-page/DESIGN.md`
  (read "Avoid the generated look" and "When the treatment is editorial" closely). For the
  real product's look, these screenshots are worth a glance (Read tool):
  `/Users/aidenlx/worktrees/zotlit-v2/proto-landing-page/apps/docs/public/img/changelog/`
  (library-view.webp, pdf-reader-annotations.webp, citation-popover.webp,
  graph-view-citations.webp, query-file-and-block.webp, template-workbench-layout.webp,
  cited-by-sidebar.webp, reading-status-table.webp). `SHOTS` in the shared region points at
  them if you want a real screenshot somewhere, but this round prefers drawn, animated UI.
- Write exactly one file: `variant-<KEY>.jsx` in the folder. It holds a single paramless
  `function Variant<KEY>() { ... }` plus any helpers it needs. Mock state comes from the
  shared hooks or local `useState`, never from props.
- All variants share ONE script scope. Prefix every top-level name you add with your key:
  `A_Stage`, `A_STEPS`, `aFormat` ... Never redeclare a shared name.
- Do not edit `base.html`, `BRIEF.md`, another variant, or any file outside the folder. No
  git.
- In scope with no import: React hooks (`useState`, `useEffect`, `useMemo`, `useRef`,
  `useCallback`, `useLayoutEffect`, `Fragment`, `React`), every lucide icon as `Icons.Name`
  (`<Icons.Quote size={16} />`), motion as `Motion.*` (`Motion.motion.div`,
  `Motion.AnimatePresence`, `Motion.useScroll`, `Motion.useTransform`), and every name in
  the shared region: `useProtoState`, `setProto`, `useLoop`, `useTimeline`, `useTypewriter`,
  `useInView`, `useScrollProgress`, `ZotLitMark`, `Wordmark`, `Lockup`, `SITE`, `DOCS`,
  `FACTS`, `JOBS`, `FEATURES`, `featuresOf`, `leadOf`, `feature`, `sinceLabel`, `TIERS`,
  `INSTALL_STEPS`, `ADDONS`, `ZCOLORS`, `PAPERS`, `PAPER_KEYS`, `READING_STATUSES`,
  `LIBRARIES`, `papersIn`, `NOTES`, `citedBy`, `GRAPH`, `DRAFT`, `parseCitations`,
  `inText`, `CSL_STYLES`, `Bib`, `bibText`, `ANNOTATIONS`, `PDF_TOOLS`, `protoDedent`,
  `PROFILE_DOC`, `TEMPLATE_FIELDS`, `WORKBENCH_TABS`, `RENDERED_NOTE`, `DEFAULT_NOTE`,
  `ANNOTATION_CALLOUT`, `EXPORT_DIALOG`, `ZOTQUERY_FILE`, `QUERY_LAYOUTS`, `CLI_SESSIONS`,
  `AGENT_SESSION`, `SHOTS`. Need more mock data? Define it in your file, prefixed.
- The variant root is `<div data-v="<KEY>" className="bg-ground text-ink font-body min-h-screen ...">`.
  The token values for your key are already in `base.html`.

## Styling rules

- Colour and type only through the token utilities: `bg-ground`, `bg-surface`, `text-ink`,
  `text-muted`, `border-line`, `text-accent`, `bg-accent`, `text-accent2`, `text-cite`,
  `bg-z-yellow` (and red, green, blue, purple, magenta, orange, gray), `bg-brand-navy`,
  `text-brand-orange`, `font-display`, `font-body`, `font-mono`, `font-sans`,
  `font-wordmark`. Opacity modifiers are fine (`bg-accent/15`). Tailwind's stock palette
  (`bg-slate-900`, `text-gray-500`, `bg-white`, `text-black`) is off limits: it breaks the
  dark scheme. In SVG use `fill="var(--surface)"`, `stroke="var(--line)"` and so on.
  Arbitrary values for size, spacing, rotation are fine.
- Keyframes or extra CSS: render a `<style>{`...`}</style>` inside your root, keyframe names
  prefixed with your key in lower case (`a-pulse`), selectors scoped under `[data-v="<KEY>"]`.
- Brand: use `ZotLitMark` / `Lockup` / `Wordmark`; never redraw the mark. On a dark ground
  pass the dark inks: `ink="#D8E2F0" accent="#F0793F"`.
- Check both colour schemes: the tokens switch with `prefers-color-scheme`. A drawn app
  window may keep its own fixed app colours if your concept calls for it (variant E).
- Motion: every loop must freeze on a meaningful finished frame when
  `useProtoState().motion` is false (the shared hooks already do; do the same for your own
  timers and for CSS animation, for example `animationPlayState`). One orchestrated moment
  lands harder than scattered effects.
- Layout must work at 390 px wide: 16 px side gutters, no horizontal page scroll. A wide
  demo scales down or scrolls inside its own container. Leave 6rem at the bottom of the page
  free for the switcher bar.
- Visible keyboard focus. Interactive things are `<button>` / `<a>`.

## Copy rules

- Sentence case for headings and labels (Obsidian style). Short sentences. Active voice.
  Simple words. Say the research outcome ("Your highlights land in your notes, with page
  numbers"), not the mechanism.
- No applause lines and no marketing words ("supercharge", "seamless", "unlock",
  "effortless", "game-changer", "powerful", "revolutionize", "elevate"). No em dashes in your
  own copy. No "not X, but Y" constructions.
- Keep facts true to the shared data. Do not invent features, numbers, testimonials or
  quotes. Feature names exactly as in `FEATURES`.

## Verify in the browser before you return

The browser is the only oracle: one JSX error blanks the whole page for every variant.
Use plain literal commands with absolute paths. The session guard refuses shell variables,
`$(...)`, and any command that contains the word `eval`.

1. `cp <folder>/base.html <folder>/test-<KEY>.html`
2. `python3 /Users/aidenlx/.claude-multi/accounts/acct-20261016-20621efa214143fcad754100df403b8d/skills/prototype/assemble.py <folder>/test-<KEY>.html <folder>/variant-<KEY>.jsx`
   (re-copy base.html first each time; assemble splices into the copy in place).
3. Run `agent-browser skills get core` once for the command reference. Pass
   `--session proto-desk-<KEY>` on every agent-browser command. Open
   `file://<folder>/test-<KEY>.html#<KEY>`, then
   `wait --fn "document.getElementById('root').children.length > 0"`, then `console` and
   `errors`: both must be free of errors.
4. Take screenshots at 1440×900 and at 390×844, at the top and while scrolling through the
   whole page, in light mode and once in dark mode (`set media dark` or the equivalent in
   the core guide). Look at each one with the Read tool. Fix what is broken, overlapping,
   clipped, unreadable, cluttered or generic, then reload and look again. Check that a demo
   animates (screenshot twice, a few seconds apart) and that interactive parts respond.
5. Finish: keep your best screenshots as `shot-<KEY>-desktop.png` and
   `shot-<KEY>-mobile.png` (top of page), delete `test-<KEY>.html` and other screenshots,
   close your browser session.

## Return

Only: the path of `variant-<KEY>.jsx`, and 3 to 5 lines: the concept, the section order,
and anything that does not work yet. Keep the JSX out of your reply.
