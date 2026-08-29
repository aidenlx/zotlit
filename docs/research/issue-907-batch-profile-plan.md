# Prototype plan — Profile selection in the batch update and import run (ticket #907, map #835)

## The design question
When a run touches many items at once — some with existing notes (their stamps win), some without — where does the Profile for the **new** notes come from, does the user ever see a picker, and what do the run summary and its notice say about the Profile that was used?

## Ground truth (apps/obsidian today)
- Entry points: command "Update all literature notes"; Companion link `obsidian://zotlit/update-many` and its HTTP push (both may carry a headless `profileId`); per-library/collection `update-all`. ≥2 items → BatchModal: loading → confirm (intro "Update or create N literature notes?", groups Update (n) / Create (n) / Not found (n), buttons Cancel · Update notes) → progress → summary ("Done. 3 created, 5 updated, 0 failed." + same text as a Notice).
- Existing note: its `zotlit-profile` stamp wins. A headless `profileId` that differs from a stamp REFUSES that item (it lands in Failed). New note: `profileId` if given, else the bound default (Default Profile). There is no last-used memory in batch today.
- Import notes run: an Imported Note inherits its parent item's Literature Note stamp; a parent without a Literature Note → Default. No picker anywhere.

## First-principles reading (academic user)
A batch run is "bring my vault up to date with Zotero" — a maintenance chore, not an authoring act. Attention is on the count, not on items.
1. Per-item questions are unacceptable at N=200; N=3 is not a different feature.
2. The only decision in a run is for the CREATE group. It is one decision per run, and it must be visible BEFORE the run writes (the confirm screen already exists for exactly this).
3. Existing notes are never re-stamped by a run (consent rule from #904). A headless Profile that conflicts with a stamp is a conflict to SHOW, not a silent failure.
4. The summary must name the Profile the new notes got — the one fact the user cannot infer from a count. "Done. 3 created under Articles, 5 updated." Notice carries the same words.
5. Import run: Imported Notes follow the parent's Literature Note. Only orphans (parent has no Literature Note) need a Profile — the same "new notes" decision, on the same confirm screen.
6. Zero extra Profiles: no Profile UI at all, the modal is byte-identical to today, the summary says "Done. 3 created, 5 updated."

## Variants (3; structurally different answers to "who picks the Profile for the create group")
  A  Ask up front, one Profile for the run  — when the Create group is non-empty and >1 Profile exists, the informed picker (#904's rows: folder · style · template · resulting folder, last-used preselected) opens BEFORE the batch modal; the confirm screen then shows "Create (3) → Articles" as the group header; summary "Done. 3 created under Articles, 5 updated, 0 failed."
  B  Decide on the confirm screen, per-item fallback — no picker modal. The confirm screen's Create group header carries an inline Profile dropdown ("New notes go to: [Articles ▾]"), preselected from the run's Profile (headless) else last-used else Default; each Create row shows its resulting path live; Update rows show their stamp as a muted pill and never change; a headless Profile conflicting with a stamp shows the row under "Kept as is (n)" instead of failing. Summary groups by Profile: "Done. 3 created under Articles, 5 updated (4 Articles, 1 Default), 0 failed."
  C  Last-used, no question — the run never asks; Create rows show the resulting path under the last-used Profile; a one-line footnote on the confirm screen "New notes use Articles (last used) · Change…" opens the informed picker only on click. Summary "Done. 3 created under Articles (last used), 5 updated, 0 failed." Notice identical. Zero extra Profiles: footnote absent.
  All three: existing stamps win; the run never re-stamps; zero extra Profiles → no Profile UI.

## Scenarios (switcher presets, mutate the shared store)
  "mixed"       — 3 Profiles; 8 items: 5 have notes (4 Articles, 1 Default), 3 have none.
  "all-new"     — 3 Profiles; 6 items, none has a note.
  "headless"    — 3 Profiles; Companion push carries profileId=Thesis; 8 items: 5 noted (4 Articles, 1 Default) → conflict, 3 new.
  "zero-extra"  — 1 Profile (Default only); same 8 items, the 5 notes stamped Default.
  "import"      — 3 Profiles; Import notes run: 6 Zotero notes: 4 whose parents have Literature Notes (Articles), 2 orphans.

## Treatment and tokens
Same as #904 (docs/research/issue-904-profile-selection-plan.md): utilitarian mock Obsidian window + right rail; identical `:root` tokens (--ground #ffffff/#1e1e1e, --ground-2 #f5f5f3/#262626, --line #e3e2df/#383838, --ink #222222/#dcddde, --muted #7b7975/#9c9c98, --accent #7f6df2/#a78bfa, --danger #e93147/#fb464c); IBM Plex Sans (display) + IBM Plex Mono (paths, stamps, hotkeys) + system-ui body. Layout: grid `minmax(0,1fr) 300px` — ObsidianFrame stage left, Rail right, switcher bar bottom.

## Shared store contract (module-level, provider-free, `useProtoState()`)
state = {
  scenario, profiles (as #904 ALL_PROFILES), items: [{key,title,type,library, note?: {path, profileId}}],
  zoteroNotes (import scenario): [{key,title,parentKey}],
  run: { kind: "update"|"import", headlessProfileId: string|null|undefined, phase: "idle"|"picker"|"confirm"|"progress"|"summary", createProfileId, result?: {created, updated, kept, failed, byProfile: {label: n}} },
  lastUsedProfileId, notices, log
}
actions = { setScenario, startRun(kind), chooseCreateProfile(id), confirm(), finish(), close(), setLastUsed(id), notify(text) }
Path rule `${profile.folder}/${itemKey}.md`; import path `${profile.importFolder ?? "zotero_notes"}/${noteKey}.md`.
Resolution record (rail readout, always visible): { source: "asked"|"last-used"|"bound"|"stamp"|"headless", pickerShown: boolean } per group.

## Shared primitives
Reuse #904's: ObsidianFrame, Prompt, SuggestRow, Dialog, Notice, Rail, Kbd, Pill, TreeFolder. Add `<BatchModal title intro groups=[{header, rows:[{label, aside?, pill?, status?}]}] footer>` mirroring apps/obsidian/src/views/batch-modal/shell.ts (60vh flex column: intro p, scrollable grouped list, Setting-row footer with Cancel + CTA), and `<ProgressBar value total />`.
