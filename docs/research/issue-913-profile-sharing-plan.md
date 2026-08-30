# Prototype plan v2 — Profile export and import from the academic user side (ticket #913, map #835)

Second pass. The first gallery (five variants, commit `f6ccb3c3b`) was built on the two-home
Profile format. [Decide where a Literature Note Profile lives](https://github.com/aidenlx/zotlit/issues/916)
(ADR 0031) and its implementation (#917, commit `0a7f8b8d8`) changed the ground under it:

- **The Profile is its document.** Every `zotlit-profile.<slug>.md` in the template folder is
  a Profile the moment it is there — by paste, sync, git, drag. Nothing registers or installs.
- **The `id` in the file is the Profile ID** (12-char Nano ID, minted, never authored). The
  note stamp points at it. A file arriving with an ID the vault already holds is a **second
  edition of that Profile**, never a new one. Two files with one ID are *both* excluded from
  the registry (`duplicate-profile-id`) and their notes hit the unknown-Profile backstop.
- **Bindings travel sparse** as flat manifest keys (`folder`, `citationStyle`, `importFolder`,
  `importColoredHighlights`, `importAnnotationsAsTemplate`). A sender leaves folders unset so
  the recipient's Default applies. "Which bindings travel" is dissolved.
- **The Pack service, its install records and revert are deleted.** `exportLiteratureNotePack`
  (partial bundling into the manifest) survives as a pure function.
- The settings tab keeps: the Profile list, the Default's binding rows, `Add profile`,
  `Open template document`, `Duplicate`, `Delete profile` (delete = move, #911).

So variant C of the first gallery ("the file is the profile") is now the **format**, and what
the ticket still has to rule is narrower:

1. the **export** entry and what the shareable copy looks like as plain text;
2. the **import seam for text from outside the vault** — preview → write — and the consent
   surface with folder · style editable before anything is written;
3. the **second-edition consequences** when the arriving file's `id` is already in the vault,
   including the *in-place* collision (the file was dropped in, no seam was crossed);
4. **going back**, with no records to revert to.

## First-principles reading (unchanged where it still holds)

The researcher's five reference points — Obsidian snippet, Zotero CSL style, Pandoc defaults,
a shared `.bib`, OZI copy-paste — still agree: the unit is a **file**, taking it in is
**additive**, identity is a **name inside the file**. ADR 0031 made all three literally true.

What is new is the asymmetry the *same ID* creates:

- Creating a Profile touches **zero notes** — as safe as installing a CSL style.
- A second edition re-renders **N notes on their next update** (Managed Block + Managed
  Frontmatter) — the consequence class of Switch Profile (#904) and delete-as-move (#911), so
  it belongs behind the same stated count.
- **The in-place trap.** Because the vault *is* the registry, a second edition can arrive with
  no dialog at all (Obsidian Sync, git pull, drag into the folder). Then either the bytes were
  overwritten silently (same filename) or two files carry one ID and *both* are excluded —
  the recipient's 40 working notes go stale the moment a lab mate's file lands beside theirs.
  Every variant must render what the researcher sees in that moment, because that is the
  route the ticket's SYNC persona takes.
- **Going back has no record.** The candidates are: Obsidian's own trash / File Recovery
  (nothing ZotLit-specific), keeping the previous edition as a sibling *out of the registry*
  (drop the `zotlit-profile.` prefix → `reading-group (before 1.1).md`, rename back to
  restore), or never replacing at all (the incoming edition becomes a separate Profile and
  notes are *moved* with #911's machinery, which is already reversible by moving back).

**The export side has one real decision left:** the sender's file carries `folder: Reading/lit`
because the sender uses it. The shareable copy must either strip location keys (and say so) or
ship them for the recipient to edit at the seam. ADR 0031 expects the former; the variants show
both readings. The copy must also bundle vault-global partials (`authors`) into the manifest,
or hand copy-paste loses them silently — the #1 failure of the baseline.

## Scenarios (the switcher drives every variant through the same four)

1. **SEND** — Anna sends "Reading group" (id `k7Qm2xLp9VwE`, v1.0, 40 notes + 6 Imported
   Notes, folder `Reading/lit`, style `chicago-note`, renders the `authors` partial).
   *"What do I send?"*
2. **TAKE** — Ben has only Default; `chicago-note` is not installed, `Reading/lit` does not
   exist. He has the text from a blog post. *"What do I do with this?"* Zero notes at risk.
3. **SYNC** — the supervisor's desktop already holds `k7Qm2xLp9VwE` at v1.0 with a locally
   changed folder; the laptop's copy of the same file arrives **by sync, beside it** (slug
   collision → `zotlit-profile.reading-group.k7Qm2xLp9VwE.md`). *"Is this the one I already
   have — and why did my notes just go stale?"*
4. **EDITION** — Chen has v1.0 and edited the body (added "## Key quotes" inside the managed
   block); Anna publishes v1.1 (new frontmatter field `read-by`, changed body). *"Can I take
   the revision without losing my edit, and which notes change if I accept?"*

## Variants (4 — structurally different answers to "where is the seam, and what is a second edition")

- **A — Drop it in** (no seam; the file explorer and diagnostics are the UI). Export: file
  explorer context menu on the Profile document → `Create shareable copy` writes
  `Reading group (share).md` *outside* the template folder with partials bundled and folders
  stripped, then `Copy to clipboard`. Import: Ben pastes the text into any new note and moves
  it into `templates/` — or drags the file there. The moment it is recognized, a **note-top
  banner** on the document says what it is (name · author · version · "folder: your default ·
  style chicago-note — not installed") with `Preview a note` and `Set folder…`. Second edition:
  the `duplicate-profile-id` diagnostic *is* the surface — a banner on both files: "Two files
  carry the Reading group ID — 40 notes wait until you pick one · [Keep mine] [Take theirs]
  [Keep both as separate profiles]". Going back: Obsidian trash. Bet: zero new UI; the format
  carries the whole flow.

- **B — Import sheet** (settings-first; the Zotero CSL model). Export: the Profile row gains
  `Share…` → one sheet: version (editable, suggests bump), author, description, "Your folders
  are left out (Reading/lit, Reading/imports) — [ ] include them", partials bundled line;
  `Copy as text` / `Save file…`. Import: `Add profile ▾` grows `From text or file…` (also a
  command and the #904 picker's `New profile…` row). One sheet: paste box → flips to the
  preview: manifest header in the researcher's words, live render of one of *the recipient's
  own* items, folder (editable, resting at "Same as Default") · style (editable, "not
  installed" state), "Writes `templates/zotlit-profile.reading-group.md` (with 1 partial
  inside)", "None of your notes change." CTA `Add profile`. Same ID present → the sheet
  becomes the **second-edition sheet**: "You already have Reading group (v1.0 · 40 notes)",
  rendered before/after on one of Chen's notes with his edit highlighted as *lost*, choices:
  `Replace mine` (40 notes re-render on next update; previous file kept as
  `reading-group (before 1.1).md`, out of the registry), `Add as separate profile` (fresh ID,
  nothing changes), Cancel. In-place collision: a Notice + the same sheet opened from the
  diagnostic. Bet: one modal per act.

- **C — Open it first** (the workspace tab is the consent surface; ADR 0017 "the file is the
  editor" taken literally). Export: `Open shareable copy` opens the bundled text in a **new
  read-only tab** with a banner "Shareable copy of Reading group v1.0 · partials bundled ·
  folders left out · [Copy] [Save as…]" — Anna reads exactly what leaves. Import: the command
  `Open profile from clipboard` (also the settings door, also an `obsidian://zotlit?profile=`
  link from the blog post) opens the incoming text as a tab **not yet in the vault**, with a
  `Source | Preview` toggle (preview = rendered against Ben's own item) and a banner carrying
  folder · style fields and `Add to my vault`. Second edition: the same tab opens as a
  **side-by-side diff against the current file**, Chen's edit marked, banner offers `Replace`
  / `Keep both` / `Close`. In-place collision: opening either file shows the diff tab. Going
  back: the replaced edition stays open in a tab until closed ("Save as…" to keep it). Bet:
  a whole tab earns its weight over a sheet because the researcher can *read* the file.

- **D — Always additive** (never replace; a second edition is a new Profile and notes move).
  Import through the same paste door as B, but the consent sheet has **one outcome**: a new
  Profile file, always. If the ID is already in the vault the incoming file is written with a
  **fresh ID** and the label `Reading group 1.1`, and the sheet ends with an offer: "Move the
  40 notes on Reading group 1.0 to Reading group 1.1?" — the #911 delete-as-move dialog
  (count, re-render line, Imported Notes checkbox), optional. Going back = move them back
  (or delete-as-move 1.1 → 1.0). Export: `Share…` on the row, as B. In-place collision:
  ZotLit resolves it *for* the researcher by minting a fresh ID into the newer file and posting
  a Notice "Reading group arrived twice — kept both; the newer one is 'Reading group (2)'
  with no notes · [Move notes…]". Bet: no consequences dialog exists at all, because nothing
  ever changes a stamped note without the researcher moving it.

## The six surfaces every variant renders

1. the export entry; 2. **the shareable copy as plain text**; 3. the import entry;
4. the consent step(s) before anything is written; 5. the second-edition surface, reached
both from the seam (EDITION) and in place (SYNC); 6. going back.

## Treatment and tokens

Inherited unchanged from the #904 / #911 / #913-v1 galleries (same file lineage): utilitarian,
mock Obsidian window + explainer rail, tokens `--ground --ground-2 --line --ink --muted
--accent --danger`, IBM Plex Sans/Mono, grid `minmax(0,1fr) 300px`, top switcher pill with the
four scenario presets.

## Shared store contract (module-level, provider-free, `useProtoState()`)

```
state = {
  scenario: "send" | "take" | "sync" | "edition",
  persona: { name, role },
  templateFolder: "templates",
  defaults: { folder: "literatures", importFolder: "literatures/imports", style: "Built-in default" },
  installedStyles: ["apa", "chicago-author-date", "ieee"],        // never chicago-note in TAKE
  files: [ { path, kind: "profile"|"note"|"other", manifest?, body?, edited?: boolean,
             excluded?: "duplicate-profile-id"|"invalid-profile-document" } ],
  // profiles are DERIVED from files: every templates/zotlit-profile.*.md that is not excluded
  notes: [ { key, title, path, profileId, imported } ],           // profileId = manifest id or null (Default)
  incoming: { source: "paste"|"file"|"link", filename, text, manifest, body } | null,
  previewItem,                                                     // one of the recipient's own items
  activeFile, notices: [], log: [],
}
actions = {
  setScenario(id),
  exportProfile(id, { includeFolders, target: "clipboard"|"file"|"tab", version }),
  stageIncoming(source)                          // fills incoming from the scenario's text
  writeIncoming({ folder, style, asNewId })      // creates the file; asNewId mints a fresh id
  replaceProfile(id, { keepPrevious })           // second edition: overwrite; optional out-of-registry sibling
  resolveCollision(id, "mine"|"theirs"|"both")   // SYNC: pick a file, or mint a fresh id into one
  moveNotes(fromId, toId, { imported })          // #911 delete-as-move / migration
  dropFileIntoTemplates(path), renameFile, trashFile, restoreFromTrash,
  installStyle(name), openFile(path), notify(text, actions), dismissNotice(id), pushLog(text),
}
```

Helpers: `profiles(state)` (derived, with `noteCount` / `importedCount` / `excluded`),
`profileById`, `stampLabel(profile)` → `Reading group (k7Qm2xLp9VwE)`, `shareableText(profile,
{ includeFolders })` → the exported markdown (manifest with `partials:` bundled, `folder` /
`importFolder` stripped unless included), `renderNote(profile, item)` → lines, `diffLines(a, b)`.

## Shared primitives contract

Carried over from the v1 gallery: `Kbd`, `Pill`, `Notice`, `Prompt`, `SuggestRow`, `Dialog`,
`CommandPalette`, `IconButton`, `SettingRow`, `SettingsModal`, `ProfilesPage`, `Banner`,
`SearchPane`, `Rail` / `RailHeading`, `ObsidianFrame` (ribbon, file tree, tab bar, editor with
Properties, status bar, `overlay`, `sidePane`, `statusItems`), `FileText`, `NotePreview`,
`ManifestHeader`, `EntersYourVault`, `YourSettingsRow`, `ShareSheet`, `ContextMenu`.
`ProfilesPage` is re-cut to the #917 settings surface: Default's binding rows, then one row per
discovered Profile with `Open` · `Duplicate` · `Delete`, excluded files listed with their
diagnostic, and `Add profile` at the top.

Every `VariantX()` returns the frame + rail grid, holds only its own UI state, drives the store
through `actions`, and its Rail carries: the thesis; the four researchers' questions with this
variant's one-line answer each; the numbered steps to try for the current scenario; the store
readout (files in `templates/`, derived Profiles with counts and exclusions, the incoming text,
the trash) and the log.
