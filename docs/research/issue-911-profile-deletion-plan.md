# Prototype plan — Profile deletion from the academic user side (ticket #911, map #835)

## The design question
A Literature Note Profile goes away while notes still carry its stamp. What does the
academic user experience at that moment, and which deletion semantics follow from that
experience — not from the current settings dialog?

## First-principles reading (academic user)
What a Profile *is* to the researcher: "a kind of note" — folder + citation style + look.
What a note *is*: their durable work. Forty notes outlive any configuration.
The stamp is a pointer from the durable thing to the configuration. Deleting the
configuration leaves a dangling pointer; the classic resolutions are the same three every
system has: RESTRICT (refuse), SET DEFAULT / re-point (move), or soft delete (tombstone).

Three researchers, three questions — the scenario presets of the prototype:
  1. FOLD    "Book chapters" (40 notes, 6 Imported Notes) → fold back into Default.
             Question: "what happens to my forty notes?"           → intent is a MOVE.
  2. RETIRE  "Thesis" (12 notes, 3 Imported Notes) after graduating.
             Question: "can I still update them (if I ever need to)?" → intent is ARCHIVE;
             the notes are finished; a tax on them is pure cost.
  3. OOPS    "Articles" (23 notes) deleted by mistake while tidying settings.
             Question: "how do I get it back?"                     → intent is UNDO.
Consequences:
  a. Nobody, in any of the three, wants a note that "cannot update". A stale stamp is a
     state the plugin invents, never one the researcher asked for. If it must exist, it
     has to be harmless at rest (the note opens, reads, links) and speak only at use time,
     in the researcher's words, with the fix one click away.
  b. "Recreate this profile with the same ID" is not in the researcher's vocabulary and
     is not doable by hand (UUID). The recovery path must be a button, not an instruction.
  c. The spec rule "never change a note's appearance silently" means folding 40 notes into
     Default is a consented re-stamp with consequences stated (template re-render on next
     update, folder move optional, Imported Notes ride along) — the exact dialog #904 already
     ruled for Switch Profile. Deletion with re-stamp is that dialog, batched.
  d. Obsidian's own idioms for "I removed a thing that other things point at":
     · delete a file → link breaks, becomes an unresolved link, shows in the graph/backlinks,
       file sits in .trash → reversible, visible, harmless.
     · delete a folder → asks once, trash, reversible.
     · disable a plugin → its notes keep their text; features pause; re-enable restores.
     None of them refuse. All of them are reversible and show the consequence where the
     user meets it. That favours tombstone/undo over refuse.
  e. The count matters in every variant: "40 notes" turns an abstract warning into the
     researcher's own situation. Counting needs a vault scan of `zotlit-profile` stamps — a
     search query `["zotlit-profile":<id>]` is also the researcher-facing "show these notes".
  f. Where the researcher meets a deleted Profile: the settings Profiles list, the delete
     dialog, the note's Properties (stamp), the "Update from Zotero" command on that note
     (use-time diagnostic, plus its Imported Note twin), and the Switch Profile picker.
     Every variant must render all six surfaces so they can be compared side by side.

## Variants (5 = ceiling; structurally different answers to "what happens to the stamped notes")
  A  Baseline (today)          — one confirm dialog, no count, no consequence shown; stale stamp
                                 renders as a raw UUID; "Update from Zotero" fails with the current
                                 notice ("re-stamp or recreate with the same ID"); recovery: none in UI.
  B  Refuse while referenced   — dialog names the count, offers "Show these notes" (opens search
                                 `["zotlit-profile":…]`) and "Move 40 notes to…" (batch Switch Profile
                                 consequences dialog); the Delete button is disabled until the count is 0;
                                 a 0-note Profile deletes immediately. Nothing is ever stale.
  C  Delete, visibly stale     — dialog names the count and states the consequence in note words
                                 ("keep their text and open normally; Update from Zotero pauses for
                                 them until you move them to another profile"); after deletion: a
                                 banner on the Profiles page "40 notes use a deleted profile · Move
                                 them…", the stamp shows "(deleted profile)" with a danger pill, the
                                 use-time notice carries a "Switch profile…" button, the picker never
                                 lists it. Recovery = batch move from the banner or per-note switch.
  D  Delete = move             — the dialog *is* the Switch Profile consequences dialog, batched:
                                 "40 notes use this profile. Move them to [Default ▾]" + checkboxes
                                 (move files to the target folder; include 6 Imported Notes) + the
                                 template consequence line; CTA "Delete and move 40 notes". No stale
                                 state exists; a 10-second Notice offers "Undo" (recreates the record
                                 and re-stamps back). The template document file is never deleted.
  E  Retire (tombstone, self-cleaning) — deleting a referenced Profile *retires* it: it leaves the
                                 pickers and creation, its notes keep updating exactly as before, it
                                 stays in settings greyed under "Retired · 40 notes" with "Restore",
                                 "Move notes to…", "Delete anyway" (→ C's stale state); it disappears
                                 by itself when the last note leaves. An unreferenced Profile deletes
                                 immediately. Stamp shows "Thesis (retired)" muted; use-time update
                                 works and mentions nothing.
  Every variant: the action lives in Settings → Profiles (trash icon on the row / page). Variants
  C–E also expose "Move notes from … to …" as a batch operation reachable from the settings surface.

## Treatment and tokens (inherited from the #904 prototype — same file lineage)
Utilitarian. Mock Obsidian window + explainer rail, exactly the #904 gallery's stage, so the
dialogs read at true fidelity. Tokens unchanged: --ground #ffffff→#1e1e1e, --ground-2
#f5f5f3→#262626, --line #e3e2df→#383838, --ink #222222→#dcddde, --muted #7b7975→#9c9c98,
--accent #7f6df2→#a78bfa, --danger #e93147→#fb464c. Type: body = system-ui stack; display =
IBM Plex Sans 600; mono = IBM Plex Mono. Layout: grid `minmax(0,1fr) 300px` (frame · rail);
switcher pill fixed at the top with scenario presets.

## Shared store contract (module-level, provider-free, `useProtoState()`)
state = {
  scenario: "fold" | "retire" | "oops",
  subjectProfileId,                     // the Profile the scenario is about
  profiles: [
    { id: null,   label: "Default",       folder: "literatures",               style: "Built-in default", document: "Built-in template",      noteCount: 118, importedCount: 12, status: "active" },
    { id: ART,    label: "Articles",      folder: "literatures/articles",      style: "apa",              document: "templates/articles.md",  noteCount: 23,  importedCount: 4,  status: "active" },
    { id: BOOK,   label: "Book chapters", folder: "literatures/book-chapters", style: "chicago-note",     document: "templates/book-chapter.md", noteCount: 40, importedCount: 6, status: "active" },
    { id: THESIS, label: "Thesis",        folder: "projects/thesis/reading",   style: "chicago-author-date", document: null /* bindings-only */, noteCount: 12, importedCount: 3, status: "active" },
    { id: SCRATCH,label: "Scratch",       folder: "inbox",                     style: "Built-in default", document: "Built-in template",      noteCount: 0,   importedCount: 0,  status: "active" },
  ],                                     // status: "active" | "retired" (E) ; deleted records leave the array
  deletedProfiles: { [id]: { label, folder, style, document, deletedAt } },   // label memory for stale rendering (C) and Undo (D)
  notes: [ { key, title, path, profileId, imported: number } ],   // ~4 sample notes per Profile; counts above are the truth, the list is the sample shown in tree/search
  activeNoteKey,                          // a note stamped with the subject Profile
  search: null | { query, profileId },    // open mock search pane
  notices: [{ id, text, action?: { label, onClick } }],
  log: [{ t, text }],
}
actions = {
  setScenario(id),
  deleteProfile(id)                       → removes record, remembers it in deletedProfiles; notes keep stamp (A, C)
  retireProfile(id)                       → status "retired" (E)
  restoreProfile(id)                      → from retired or from deletedProfiles (E restore, D undo)
  moveNotes(fromId, toId, { moveFiles, includeImported }) → re-stamps every note of fromId (counts + samples + paths), logs the consequence line; if fromId is retired and its count hits 0 it vanishes (E)
  recreateProfileWithSameId(id)           → baseline's only recovery (A)
  updateFromZotero(noteKey)               → returns { ok: true } or { ok: false, kind: "unknown-profile", id } and pushes the matching notice; retired Profiles update fine (E)
  showNotes(profileId)                    → search = { query: `["zotlit-profile":${id}]`, profileId }
  closeSearch(), notify(text, action?), dismissNotice(id), openNote(key)
}
Helpers: profileById(s, id) (also looks in deletedProfiles, returning status "deleted"), stampLabel(s, note) → { label, secondary, status }, PROFILE_DISPLAY(profile).

## Shared primitives contract (defined above the variant regions; variants use the globals only)
Keep from #904: `Kbd`, `Pill`, `Notice`, `Prompt`, `SuggestRow`, `Dialog`, `CommandPalette`, `Rail`
(RailHeading), `ObsidianFrame` (ribbon, file tree derived from state.notes + templates/, tab bar,
editor with Properties incl. the stamp via `stampRender(note, profileInfo)`, status bar, `overlay`,
`statusItems`; add a `sidePane` prop rendering the mock Search pane on the left when state.search is set).
New:
- `<SettingsModal open onClose page="profiles" | { profileId }>` — Obsidian settings modal: left
  nav ("ZotLit" selected), right content. `ProfilesPage` lists Default + every Profile as setting rows
  (name · "folder · style · document" · noteCount pill · trash icon); `ProfilePage` shows the fields and
  a "Delete profile" destructive button at the bottom. Slots: `banner` (C), `retiredSection` (E).
- `<SearchPane query results total onClose>` — mock core Search: query chip, N results line, sample
  rows, "… and 37 more".
- `<MoveNotesDialog from to onTo options onConfirm onCancel>` — the #904 Switch Profile consequences
  dialog, batched: target dropdown (active Profiles only), consequence line "Managed content and
  properties re-render from <document> on the next update", checkbox "Move files to <folder>/" when
  folders differ, checkbox "Also move N imported notes", CTA text from the caller.
- `<Banner tone text action>` — a settings-page callout.
Every `VariantX()` returns `<div className="grid h-full" style={{gridTemplateColumns:"minmax(0,1fr) 300px"}}> <ObsidianFrame …/> <Rail …/> </div>`,
holds its own UI state (settings open, page, dialog, picker), and drives the store through actions.
The Rail for each variant: thesis; the three persona questions with this variant's one-line answer
each; numbered steps to try; the store readout (profiles table with status/count, deleted/retired
records, active note stamp) and the log — the Rail renders the readout itself from state.
