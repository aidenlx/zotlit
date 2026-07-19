// Reusable workflow: implement one docs-site-v2 issue ticket end-to-end.
// Invoke with args: { issue: ".scratch/docs-site-v2/issues/NN-slug.md" }
export const meta = {
  name: 'docs-issue',
  description: 'Implement a docs-site-v2 issue: scope facts → docs-writer writes → fable review + slop-check → fix loop → build green',
  whenToUse: 'Any ticket under .scratch/docs-site-v2/issues/ whose blockers are done. Pass the ticket path as args.issue.',
  phases: [
    { title: 'Scope', detail: 'opus explorers: product facts + docs-app survey', model: 'opus' },
    { title: 'Write', detail: 'docs-writer authors pages; code-edit builds MDX components' },
    { title: 'Review', detail: 'fable spec + standards review; slop-check per page', model: 'fable' },
    { title: 'Fix', detail: 'docs-writer applies fixes; slop re-check loop' },
    { title: 'Verify', detail: 'lint + build green' },
  ],
}

let input = args
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch { input = { issue: input } }
}
const issue = input && input.issue
if (!issue) throw new Error('Pass args: { issue: ".scratch/docs-site-v2/issues/NN-slug.md" }')

const PRD = '.scratch/docs-site-v2/PRD.md'
const SLOP_SKILL = '~/.claude/skills/slop-check'

const SEV = { enum: ['high', 'medium', 'low'] }
const FACTS_SCHEMA = {
  type: 'object', required: ['facts', 'openQuestions'],
  properties: {
    facts: { type: 'array', items: { type: 'object', required: ['claim', 'source', 'verbatim'], properties: {
      claim: { type: 'string', description: 'product fact the docs page will assert' },
      source: { type: 'string', description: 'file:line it was verified against' },
      verbatim: { type: 'string', description: 'exact UI string / command name / setting label as shipped' },
    } } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}
const SITE_SCHEMA = {
  type: 'object', required: ['targetPages', 'components', 'conventions'],
  properties: {
    targetPages: { type: 'array', items: { type: 'object', required: ['path', 'action', 'notes'], properties: {
      path: { type: 'string' }, action: { enum: ['create', 'edit'] }, notes: { type: 'string' },
    } } },
    components: { type: 'array', items: { type: 'string' }, description: 'existing MDX-usable components + import patterns' },
    conventions: { type: 'array', items: { type: 'string' } },
  },
}
const WRITE_SCHEMA = {
  type: 'object', required: ['pages', 'componentSpecs', 'unverified'],
  properties: {
    pages: { type: 'array', items: { type: 'object', required: ['path', 'summary'], properties: {
      path: { type: 'string' }, summary: { type: 'string' },
    } } },
    componentSpecs: { type: 'array', items: { type: 'object', required: ['file', 'spec'], properties: {
      file: { type: 'string' }, spec: { type: 'string', description: 'behavior + props as used from the MDX' },
    } } },
    unverified: { type: 'array', items: { type: 'string' } },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: { findings: { type: 'array', items: { type: 'object', required: ['file', 'severity', 'summary', 'fix'], properties: {
    file: { type: 'string' }, line: { type: 'number' }, severity: SEV,
    summary: { type: 'string' }, fix: { type: 'string' },
  } } } },
}
const SLOP_SCHEMA = {
  type: 'object', required: ['flags'],
  properties: { flags: { type: 'array', items: { type: 'object', required: ['line', 'code', 'severity', 'text', 'fix'], properties: {
    line: { type: 'number' }, code: { type: 'string' }, severity: SEV,
    text: { type: 'string' }, fix: { type: 'string' },
  } } } },
}
const BUILD_SCHEMA = {
  type: 'object', required: ['green', 'notes'],
  properties: { green: { type: 'boolean' }, notes: { type: 'string' } },
}

const ticketRef = `Ticket: ${issue}. Parent spec: ${PRD}. Read both in full first.`

// ── Phase 1: Scope ─────────────────────────────────────────────────────────
// Barrier is intentional: the writer needs both briefs together.
phase('Scope')
log(`Scoping ${issue}`)
const [facts, site] = await parallel([
  () => agent(`${ticketRef}
You are a fact-finder for a documentation page. Explore the plugin source to verify every product fact the ticket's page(s) will assert: exact command names/ids, palette entries, menu labels, UI strings (paraglide message catalogs under messages/ and per-app messages), setting keys/labels/defaults, ribbon/context-menu entry points, and the actual runtime behavior the page describes (apps/obsidian, apps/zotero, packages/protocol, packages/templates as relevant). Quote each string verbatim with its file:line. Record anything you could not verify as an open question — never guess. Return only the structured result.`,
    { label: 'scope:facts', phase: 'Scope', model: 'opus', schema: FACTS_SCHEMA }),
  () => agent(`${ticketRef}
You are surveying the docs app (apps/docs) so a writer can slot new pages in cleanly. Report: (1) targetPages — exact content file paths to create/edit for this ticket per the PRD page tree, plus meta.json edits needed; (2) components — existing React components usable from MDX (and any mdx-components mapping / import convention), noting which suit illustrations or interactive playgrounds; (3) conventions — frontmatter shape, fumadocs config (source.config.ts), how neighboring pages are structured, register per the docs-writing skill (.claude/skills/docs-writing). Return only the structured result.`,
    { label: 'scope:site', phase: 'Scope', model: 'opus', schema: SITE_SCHEMA }),
])
if (!facts || !site) throw new Error('Scope phase failed — missing facts or site survey')

// ── Phase 2: Write ─────────────────────────────────────────────────────────
phase('Write')
const factsBrief = JSON.stringify(facts)
const siteBrief = JSON.stringify(site)
const draft = await agent(`${ticketRef}
Implement this ticket's pages. Verified product facts (claim + verbatim string + source): ${factsBrief}
Docs-app survey (target files, available components, conventions): ${siteBrief}
Rules: use only the verified facts for product claims — anything not in the facts list gets flagged as unverified, not invented. Follow the PRD page tree and the ticket's acceptance criteria exactly. Update meta.json files so the nav matches.
Illustrations: where a diagram, illustration, or small interactive playground would genuinely help the reader (flows, before/after, try-it widgets), you are encouraged to use React components in the MDX. Prefer existing components from the survey; where a new one is needed, write the MDX usage as you want it and return a componentSpec (file path + behavior + props) — a code worker will implement it. Do not write component code yourself.
Return the structured result: pages written, componentSpecs, unverified claims.`,
  { label: 'write:pages', phase: 'Write', agentType: 'docs-writer', schema: WRITE_SCHEMA })
if (!draft || !draft.pages.length) throw new Error('Writer returned no pages')
log(`Wrote ${draft.pages.length} page(s), ${draft.componentSpecs.length} component spec(s)`)

if (draft.componentSpecs.length) {
  await agent(`In apps/docs, implement these React components exactly as specced so the MDX that already uses them compiles and behaves as described: ${JSON.stringify(draft.componentSpecs)}
Match existing component style in apps/docs/components (Tailwind conventions, client/server split, mdx-components registration if that is the repo pattern). Keep each component minimal — no props or flexibility beyond the spec. Then run the docs app lint to confirm the pages compile.`,
    { label: 'write:components', phase: 'Write', agentType: 'code-edit' })
}

// ── Phase 3: Review ────────────────────────────────────────────────────────
// Barrier: fix pass wants all findings at once, deduped by file.
phase('Review')
const pageList = draft.pages.map(p => p.path)
const [specFindings, stdFindings, ...slopPerPage] = await parallel([
  () => agent(`${ticketRef}
Spec review (docs adaptation of the code-review skill's Spec axis). Diff the written pages against what was asked: read the ticket's acceptance criteria and the PRD's Implementation Decisions, then verify each one against the actual page content at ${pageList.join(', ')} (plus meta.json/nav changes). Also cross-check product claims against this verified facts sheet — flag any page claim that contradicts or exceeds it: ${factsBrief}
Flag: unmet acceptance criteria, scope creep beyond the ticket, claims about behavior the alpha does not ship, broken internal links, missing/oversized frontmatter (title <60, description <160). Severity high = acceptance criterion unmet or false product claim. Findings only — do not edit.`,
    { label: 'review:spec', phase: 'Review', model: 'fable', effort: 'high', schema: FINDINGS_SCHEMA }),
  () => agent(`Standards review of docs pages ${pageList.join(', ')} (docs adaptation of the code-review skill's Standards axis — the standards source here is the docs-writing skill at .claude/skills/docs-writing plus the PRD's Voice section in ${PRD}).
Check each page for: correct register (onboarding pages = 1Password calm-guide; everything else = Linear plain-manual), Diataxis quadrant purity (tutorial: one path, no alternatives or reference dumps; reference: no opinions or steps; explanation: no numbered procedures), page patterns (one-line opening summary, happy path first, sentence-case headings), terminology per the domain glossaries ("ZotLit" unqualified = the Obsidian plugin, Zotero add-on = "the companion"), and — if new React components were added — that the MDX usage and component code are minimal and match repo conventions. Findings only — do not edit.`,
    { label: 'review:standards', phase: 'Review', model: 'fable', effort: 'high', schema: FINDINGS_SCHEMA }),
  ...pageList.map(p => () => agent(slopPrompt(p),
    { label: `slop:${p.split('/').pop()}`, phase: 'Review', model: 'claude-opus-4-6', schema: SLOP_SCHEMA })),
])

function slopPrompt(page) {
  return `Run the slop-check audit on ${page}. The skill lives at ${SLOP_SKILL} — read its SKILL.md and references/patterns.md and follow the process exactly: run ${SLOP_SKILL}/scripts/slop-grep.sh on the file for surface hits, then do the structural pass yourself, then triage false positives. Return only the kept flags (false positives excluded) with the skill's line/code/severity/matched-text/fix-direction fields. Audit only — do not edit the file.`
}

const reviewFindings = [
  ...(specFindings ? specFindings.findings : []),
  ...(stdFindings ? stdFindings.findings : []),
].filter(f => f.severity !== 'low')
const slopFlags = pageList.map((p, i) => ({
  page: p,
  flags: (slopPerPage[i] ? slopPerPage[i].flags : []).filter(f => f.severity !== 'low'),
}))
log(`Review: ${reviewFindings.length} spec/standards finding(s), ${slopFlags.reduce((n, s) => n + s.flags.length, 0)} slop flag(s) (high+medium)`)

// ── Phase 4: Fix loop ──────────────────────────────────────────────────────
// PRD gate: fix high+medium slop flags and re-run until clean (capped rounds).
phase('Fix')
let openSlop = slopFlags.filter(s => s.flags.length)
let openReview = reviewFindings
let round = 0
while ((openSlop.length || openReview.length) && round < 3) {
  round += 1
  await agent(`${ticketRef}
Fix pass ${round} on the pages you own. Apply these review findings (docs standards + spec compliance): ${JSON.stringify(openReview)}
And clear these slop-check flags (per page, high+medium only): ${JSON.stringify(openSlop)}
Rewrite in the page's own register per the docs-writing skill; a slop fix must read as a real sentence, not a patched one. If a finding is a false positive, leave the text and say why in your report. Keep every verified product fact intact.`,
    { label: `fix:round${round}`, phase: 'Fix', agentType: 'docs-writer' })
  openReview = []
  const recheck = await parallel(openSlop.map(s => () => agent(slopPrompt(s.page),
    { label: `reslop:${s.page.split('/').pop()}`, phase: 'Fix', model: 'claude-opus-4-6', schema: SLOP_SCHEMA })))
  openSlop = openSlop
    .map((s, i) => ({ page: s.page, flags: (recheck[i] ? recheck[i].flags : []).filter(f => f.severity !== 'low') }))
    .filter(s => s.flags.length)
  log(`Fix round ${round}: ${openSlop.reduce((n, s) => n + s.flags.length, 0)} slop flag(s) remain`)
}

// ── Phase 5: Verify ────────────────────────────────────────────────────────
phase('Verify')
const build = await agent(`From the repo root, run lint and build for the docs app via turbo (pnpm lint, and turbo run build filtered to the docs app package). Fix only mechanical breakage introduced by the docs changes (imports, frontmatter syntax, meta.json references, MDX compile errors) — no prose edits, no unrelated fixes. Report green/red with the failing output if red.`,
  { label: 'verify:build', phase: 'Verify', agentType: 'code-edit', effort: 'low', schema: BUILD_SCHEMA })

return {
  issue,
  pages: draft.pages,
  componentSpecs: draft.componentSpecs,
  unverifiedClaims: draft.unverified,
  openQuestions: facts.openQuestions,
  fixRounds: round,
  disputedSlopFlags: openSlop,
  build,
}
