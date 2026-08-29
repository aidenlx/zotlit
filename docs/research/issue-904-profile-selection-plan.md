# Prototype plan — Profile selection UX (ticket #904, map #835)

## The design question
When, where, and how does an academic user choose the Literature Note Profile a new note is created under — and how do they later change the Profile of an existing note (and its Imported Notes)?

## First-principles reading (academic user)
A Profile = "which kind of note do I want for this item" (folder + citation style + template look).
Why an academic has more than one:
  - project / course context  ("PhD reading" vs "Teaching: HIST-201")  → folder differs, is SESSION-shaped (weeks of the same choice)
  - item kind                  (journal article vs book vs dataset)       → template differs, is ITEM-shaped (derivable from Zotero item type)
  - library / discipline        (law group library vs science personal)   → style differs, is LIBRARY-shaped (derivable from Zotero library/collection)
  - note purpose               (quick reading log vs deep review)        → template differs, is DELIBERATE, rare
Consequences:
  1. The choice is highly predictable from context. Asking a question the system can answer is a tax. The common case is "same as last time" or "whatever the rules say".
  2. "Create a note for item" and "open the item's note" are one gesture in the Quick Switch (Enter on a hit). If the note exists, the honest action is OPEN — a Profile question there is a category error and is where re-stamping accidents come from.
  3. Re-stamping is an operation ON A NOTE (like renaming or moving it), so it wants a note-level command with one dialog that states every consequence (template re-render, folder move or not, Imported Notes). That satisfies user story 13's consent rule without touching creation.
  4. Imported Notes belong to the item, so they ride along in the same dialog as a checkbox — the separate "switch imported note Profile" command becomes unnecessary in every variant except the baseline.
  5. Predictability criterion: the list must show what the choice DOES — folder, style, template, and the resulting file path — not a bare label (walkthrough friction #6, #7).

## Variants (5 = ceiling; structurally different answers to Q1 "when to ask")
  A  Baseline (today)         — ask on every creation with a label-only picker; existing note + different choice → destructive confirm; separate Imported Note switch command. Kept so the user compares against reality.
  B  Ask, but informed        — still ask per creation, but rows show folder · style · template · resulting path; last-used preselected (Enter = same as last time); bindings-only Profile shows "Built-in template" chip; existing note → opens directly (no picker). Switch = own command + one consequences dialog.
  C  Current Profile (mode)   — a status-bar item "ZotLit · Articles" and a "Set current Profile" command; the Quick Switch footer shows "Creating under Articles · ⇧↵ choose another"; creation is silent; ⇧↵ opens the informed picker for a one-off. Existing → opens. Switch = own command + dialog.
  D  Rules decide (auto)      — each Profile has an "Applies to" rule (item type / collection / library / tag); each search hit shows a Profile badge resolved live before Enter; Enter creates silently under the badge; ⇧↵ overrides; unmatched → Default. Shows a mini settings panel with the rules. Switch dialog adds "Re-apply rules".
  E  Profile in the search box — segmented Profile tabs across the top of the Quick Switch (Default | Articles | Thesis), Tab cycles, sticky between openings; rows show the resulting path under the selected tab; creation silent. Existing → opens, row hints "already noted under Articles". Switch = own command + dialog.
Consent rule in B–E: creation NEVER re-stamps; only the note-level "Switch Profile" command does, after one dialog.

## Treatment and tokens
Utilitarian. The page is a mock Obsidian window (default light/dark theme feel) with a narrow explainer rail on the right. The mock must feel like Obsidian so the modals read at true fidelity; the rail is the prototype's own voice.
Colours (light → dark):
  --ground    #ffffff → #1e1e1e   editor / modal surface
  --ground-2  #f5f5f3 → #262626   sidebars, status bar, secondary surface (warm-biased grey, chosen)
  --line      #e3e2df → #383838   borders / hairlines
  --ink       #222222 → #dcddde
  --muted     #7b7975 → #9c9c98
  --accent    #7f6df2 → #a78bfa   Obsidian's default interactive accent (mod-cta, selected row)
  --danger    #e93147 → #fb464c   semantic only (destructive action)
Type: body = system-ui stack (mirrors Obsidian, deliberately); display (rail headings) = "IBM Plex Sans" 600; mono (paths, stamps, hotkeys) = "IBM Plex Mono". Google Fonts link for Plex Sans + Plex Mono.
Layout: full-height grid `minmax(0,1fr) 300px`: left = ObsidianFrame stage (fake ribbon, file tree with literatures/ templates/ zotero_notes/, tab bar, editor showing the active note's Properties incl. `zotlit-profile` stamp, status bar); right = Rail (variant thesis, consent rule, step list, live state readout, event log). Bottom = switcher bar (from variants.jsx, extended with scenario preset buttons).

## Shared store contract (module-level, provider-free, `useProtoState()`)
state = {
  scenario: "one-extra" | "three-with-noted" | "zero-extra",
  profiles: [ {id:null,label:"Default",folder:"literatures",style:"Built-in default",document:"Built-in template",rule:null},
              {id:"9e5b907e-4e61-4c0a-98c7-a7d60dedc8e0",label:"Articles",folder:"literatures/articles",style:"apa",document:"templates/articles.md",rule:{itemType:"journalArticle"}},
              {id:"c1f0a2d4-7b3e-4e51-9a6d-2f8e0b7c5a11",label:"Thesis",folder:"projects/thesis/reading",style:"chicago-author-date",document:null /* bindings-only */,rule:{collection:"PhD reading"}} ],   // "zero-extra" → only Default; "one-extra" → Default+Articles
  items: [ {key:"personalAlpha2024",title:"Alpha of the personal library",authors:"Alpha, A.",year:2024,type:"journalArticle",library:"My Library",collections:["PhD reading"]},
           {key:"duplicateWithin2020",title:"Duplicate within a library",authors:"Beta, B.; Gamma, C.",year:2020,type:"journalArticle",library:"My Library",collections:[]},
           {key:"bookBeta2019",title:"Beta: a book-length study",authors:"Beta, B.",year:2019,type:"book",library:"Lab group",collections:["Teaching"]} ],
  notes: { [itemKey]: {path, profileId, importedNotes:number} },   // "three-with-noted" seeds duplicateWithin2020 under Articles with 2 Imported Notes
  lastUsedProfileId, currentProfileId, activeNoteKey, log: [{t, text}]
}
actions = { setScenario, createNote(itemKey, profileId) → {path}, openNote(itemKey), switchNoteProfile(itemKey, profileId, {moveFile, includeImported}), setCurrentProfile(id), setLastUsed(id), setRule(profileId, rule), resolveRule(item) → profileId }
Path rule: `${profile.folder}/${itemKey}.md`. Every action appends to log. Variants read state via the hook only; no props.

## Shared primitives contract (defined in the HTML above the variant regions; variants import nothing, they just use these globals)
All take className optional. Styled only with the plan's tokens (bg-ground, bg-ground-2, border-line, text-ink, text-muted, bg-accent, text-danger, font-mono, font-display).
- `useProtoState()` → `{ state, actions }` (see store contract). `profileById(state, id)` helper, `notePath(state, itemKey, profileId)` helper, `PROFILE_DISPLAY(profile)` → "folder · style · document" string.
- `<ObsidianFrame title="" footer={<StatusBar…/>} children>` — mock window: ribbon, file tree (derived from state.notes + templates/ + zotero_notes/), tab bar naming the active note, editor pane showing the active note's Properties (title, citekey, `zotlit-profile` stamp value as given by `stampRender` prop: function(note, profile) → ReactNode, default = raw UUID) plus a short body; a `overlay` prop renders modals centered over the frame with a dim backdrop. `statusItems` prop: ReactNode placed at the right of the status bar.
- `<Prompt placeholder value onChange instructions=[{command:"↑↓",purpose:"navigate"}] header? children>` — Obsidian prompt modal (search input + suggestion list + instruction footer). `header` renders a slot between input and list (used by Variant E tabs / C chip).
- `<SuggestRow selected onClick title aside? note? badge?>` — one suggestion; `note` = second line muted; `aside` = right-aligned muted; `badge` = small pill.
- `<Dialog title body actions=[{label, onClick, cta?, destructive?}] checkboxes=[{label, checked, onChange, note?}]>` — Obsidian confirm modal.
- `<Notice text />` — bottom-right toast stack element (variants call `actions.notify(text)`; frame renders `state.notices`).
- `<CommandPalette open items=[{label,onSelect}] onClose>` — a Prompt preset listing commands (used to launch "Switch Literature Note Profile…").
- `<Rail thesis steps=[…] consent="…" extras?>` — right rail; always also renders the state readout (profiles table, notes with stamps, current/last-used) and the log from state.
- `<Kbd>⇧↵</Kbd>`, `<Pill tone="accent|muted|danger">`.
Every variant component: `function VariantX(){…}` — returns `<div className="grid h-full" style={{gridTemplateColumns:"minmax(0,1fr) 300px"}}> <ObsidianFrame …/> <Rail …/> </div>` and drives its own flow with local useState (which modal is open, query text, selected index) + store actions. Keyboard: ↑↓ move selection, ↵ choose, Esc close, and the variant's own chords (⇧↵, Tab) via a keydown listener on the Prompt input (Prompt forwards `onKeyDown`).
