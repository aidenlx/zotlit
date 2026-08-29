# Prototype plan — Profile export and import from the academic user side (ticket #913, map #835)

## The design question

A researcher shaped a Literature Note Profile and wants four lab mates to have it. Another
researcher reads a blog post that says "here is my ZotLit setup" and wants those notes
without understanding any of it. What do the two experience — and which export/import
semantics follow from that experience, not from the Pack lifecycle the plugin already ships?

## Baseline: complete machinery, no door

`exportLiteratureNotePack` (`packages/templates/src/literature-note-pack.ts`) already bundles
one Profile document with its transitive partials into **one markdown file** — a YAML manifest
plus the body. `LiteratureNotePackService` (`apps/obsidian/src/services/template/pack.ts`)
previews the candidate against a real item in memory, diffs it per file (`apply` /
`unchanged` / `refuse`), refuses by default to overwrite a user-edited file, records the exact
previous bytes per file (`note.template-pack-installs`), and reverts to them.

No command, no settings control, no Workbench command, and no `messages/en.json` string names
a Pack. The lifecycle is finished; nothing reaches it.

Two facts in the shipped code carry most of the design:

1. **The manifest already separates look from location.** `profileDefaults: { folder,
   citationStyle }` are *defaults* — suggestions the sender ships — while the Profile record's
   `bindings` are the recipient's own five vault-local keys (`note.literature-folder`,
   `citation.references-style`, `note.import-folder`, `note.import-colored-highlights`,
   `note.import-annotations-as-template`). Managed Frontmatter fields live in the manifest,
   so they are already part of the document, not of the bindings.
2. **Pack identity and Profile identity are different things.** The manifest carries an
   authored `id` (`zotlit.reading-group`) and a `version`; a Profile record carries a local
   UUID that the note stamp points at. A shared document therefore can never collide with a
   recipient's note stamps — the recipient's Profile always gets a fresh local ID.

## First-principles reading (academic user)

**What the sender thinks they are sending.** Ask an academic and they say "my template" or
"my setup" — never "my Profile", which is a word they learned last week. "My setup" includes
the folder and the citation style, because to them the note *is* the thing that lands in
`Reading/lit` in Chicago style.

**What the recipient must be able to say afterwards.** "I now have a new kind of note I can
make." Not "my vault changed". This asymmetry is the whole design: the sender thinks in
wholes, the recipient must be protected from the sender's vault.

**How the same researcher already shares configuration:**

| What                        | Unit                  | Taking it in                | Identity            | Second edition                    | Undo                    |
| --------------------------- | --------------------- | --------------------------- | ------------------- | --------------------------------- | ----------------------- |
| Obsidian theme / CSS snippet | a file in `.obsidian/` | drop the file, toggle on    | the folder/file name | replace the file; browser shows "Update" | toggle off, delete file |
| Zotero CSL style            | a `.csl` file         | "Install style from file…", confirms the *name* | style ID (a URL) inside the file | re-install the same ID → "replace?" | remove from the list    |
| Pandoc defaults file        | a YAML file           | `--defaults f.yaml`          | the path            | edit the file                      | stop passing it         |
| shared `.bib`               | a data file           | put it somewhere, point at it | the path            | replace the file                   | —                       |
| OZI template (competitor)   | a text blob in a post | copy-paste into a textarea   | none                | re-paste                           | undo in the textarea    |

Three things every one of them shares:

- **a. The unit is a file** the researcher can see and open. Nothing is an opaque blob.
- **b. Taking it in is additive.** None of the five modifies work the recipient already did.
  Installing a CSL style does not restyle any bibliography until the researcher picks it.
- **c. Identity, where it exists, is a name inside the file** — the CSL style ID is the only
  one of the five with a real second-edition story, and it is exactly the Pack manifest's
  `id` + `version`.

And one thing **none** of them can do, which ZotLit can: **render the candidate against the
recipient's own item before anything is written.** The Pack service previews in memory today.
That is ZotLit's genuine advantage in this flow, and it is the map's "previewability"
criterion. Every variant must exercise it.

**The one place ZotLit is more dangerous than all five comparisons.** A Profile's document
drives the Managed Block and Managed Frontmatter of every note stamped with that Profile. So:

- an import that **creates** a Profile touches zero notes — safe, additive, and exactly what
  the five comparisons trained the researcher to expect;
- an import that **changes a Profile the researcher already has** re-renders N notes on their
  next update — the same consequence class as #904's Switch Profile and #911's delete-as-move,
  and by that precedent it belongs behind the same stated count and re-render line.

That gives the shape the variants are testing around: **taking a shared Profile in is always
additive; changing one you already have is a second, explicit act with the count stated.**
The open questions the variants actually disagree about are *where the doors are*, *what the
unit is called*, and *how much ceremony each act carries*.

**Which values may travel (question 6), from the researcher's side.** The test is: does the
value describe the *look of the note*, or the *shape of the recipient's vault*?

- look → travels **as content**: the body, the Managed Block, the Annotation Block, the
  Managed Frontmatter fields, the filename template. All already in the document.
- look, but named → travels **as a suggestion**: `citation.references-style` is a portable
  name (`chicago-note`); the recipient may not have that style installed, exactly as in Zotero.
- location → **asked**: `note.literature-folder`, `note.import-folder`. A sender's
  `projects/thesis/reading` means nothing in another vault.
- the two annotation booleans (`note.import-colored-highlights`,
  `note.import-annotations-as-template`) are the genuinely ambiguous pair — they change how an
  Imported Note *renders*, so they read as look while living in bindings. The variants
  disagree about them on purpose.

**Where the researcher meets the flow — the six surfaces every variant must render**, so the
five can be compared:

1. the export entry (sender side);
2. **the exported file opened as plain text** — the manifest and body, as a recipient who has
   never seen a manifest would first meet it (question 2 asks this explicitly);
3. the import entry;
4. the consent step, or sequence of steps, before anything is written;
5. the second-edition surface ("is this the one I already have?");
6. the revert surface.

## Scenario presets (the switcher drives all five variants through the same four)

1. **SEND** — Anna (postdoc) sends "Reading group" (40 notes, 6 Imported Notes) to four lab
   mates. Her question: *"what do I send?"* Her document renders a partial (`authors`), so
   copy-pasting the file by hand silently loses it.
2. **TAKE** — Ben (first year) found a blog post with Anna's file. He has only the Default
   Profile. Anna's style `chicago-note` is **not installed** in his vault and her folder
   `Reading/lit` does not exist. His question: *"what do I do with this file?"* Zero notes are
   at risk, and he must be told so.
3. **SYNC** — the supervisor keeps "Reading group" on a laptop and a desktop, both at v1.0,
   with a locally changed folder on the desktop. The question: *"is this the same one I
   already have?"*
4. **EDITION** — Chen has v1.0 **and edited the template body** (added a "Key quotes"
   heading); Anna publishes v1.1. The question: *"can I take the revision without losing my
   edit, and which of my notes change if I accept?"* This is the shipped `refuse` verdict on a
   `user-file`, met by a researcher.

## Variants (5 = ceiling; structurally different answers to "where are the doors, and what is the unit")

- **A — Baseline: no door.** Today. Anna opens `templates/reading-group.md`, selects all,
  pastes into Slack — and loses the `authors` partial, so Ben's notes render wrong with no
  message. Ben makes a file by hand in his template folder, opens Settings → Profiles → adds a
  Profile, points it at the file, and re-types the folder and the citation style from Anna's
  screenshot. Second edition: Anna pastes again; Chen pastes over his own edit and loses it.
  Revert: none. Renders the friction honestly, including the OZI copy-paste path as today's
  real answer.

- **B — "Install a style" (settings-first, add-only).** The Zotero CSL model. Settings →
  Profiles → `+ Add profile ▾` with three sources: *Blank*, *From a file…*, *From pasted
  text…*. One **install sheet**: the manifest header in the researcher's words (name, author,
  version, description), a live preview of one of the *recipient's own* items, "What enters
  your vault" (`templates/reading-group.md` + 1 partial), and "Your settings" — folder
  prefilled from `profileDefaults.folder` and editable, citation style prefilled by name with
  a "not installed" state. A line states "None of your existing notes change." CTA "Add
  profile". Export lives on the Profile row: `Share…` → *Save file…* / *Copy as text*.
  Second edition: importing a file whose pack id matches an installed Profile does not create
  a second Profile — the row grows a `v1.1 available` pill; opening it shows the **rendered
  note before/after** (not a source diff) plus "40 notes re-render on their next update";
  Update / Keep mine. Revert: `Revert to v1.0.0` on the row while the install record stands.

- **C — "The file is the profile" (vault-first, no import step at all).** No import command.
  Any `.md` in the vault that carries a template manifest *is* a template document. Opening one
  shows a note-top banner: `Literature note template · Reading group v1.1 by Anna ·
  [Use as profile] [Preview]`. The Profiles page gains a section "Template documents in your
  vault" listing every such file, with `Make a profile` for the unused ones. Export is
  symmetrical: right-click the document in the file explorer → `Copy shareable template`,
  which writes `Reading group (shareable).md` beside it with partials bundled in, and offers
  `Copy to clipboard`. Second edition = the researcher replaces the file (Obsidian's own
  overwrite prompt); ZotLit sees the bytes change and posts a Notice: "Reading group template
  changed — 40 notes will use it on their next update · [What changes?] [Undo]". Tests whether
  "there is nothing to install" beats a receipt.

- **D — "Share link and receipt page" (URL-first, dedicated full-page consent).** Anna's
  Profile row has `Share…` offering *Save file…*, *Copy as text*, and *Copy share link*
  (`obsidian://zotlit?profile=…`). Ben clicks the link in the blog post and Obsidian opens a
  **full workspace tab**, not a modal: the sender's identity, the live preview against Ben's
  own item, a two-column table — *what enters your vault* (template file, 1 partial, 4
  frontmatter fields) against *what you decide* (folder, citation style) — and, in bold,
  "None of your existing notes change." One button: `Add to my vault`. Everything afterwards
  lives on a new **Shared profiles** settings page: source, version, date taken in, `Check for
  updates`, `Revert`. Tests whether a full page earns its weight over B's sheet.

- **E — "Adopt or keep mine" (a ledger, maximum explicitness).** The unit is explicitly the
  whole Profile, and the **sender curates** it: the export dialog is a checklist of what
  travels — folder, citation style, imported-note folder, colored highlights,
  annotations-as-template — each showing Anna's own value, with the document and the
  frontmatter fields as fixed, always-included rows. On import the recipient meets a
  **row-per-setting ledger**: setting · sender's value · your value · `Use theirs` / `Keep
  mine`. Second edition brings the ledger back, marked with what changed since v1.0 and what
  the recipient overrode last time ("you kept `Reading/lit` — keep it again?"). Tests whether
  per-setting consent is worth the ceremony, or whether it proves "look travels, location is
  asked" by making the researcher answer five questions they have no opinion about.

## Treatment and tokens (inherited from the #904 / #911 prototypes — same file lineage)

Utilitarian. A mock Obsidian window plus an explainer rail, exactly the #911 gallery's stage,
so the sheets and dialogs read at true fidelity. Tokens unchanged: `--ground` #ffffff→#1e1e1e,
`--ground-2` #f5f5f3→#262626, `--line` #e3e2df→#383838, `--ink` #222222→#dcddde, `--muted`
#7b7975→#9c9c98, `--accent` #7f6df2→#a78bfa, `--danger` #e93147→#fb464c. Type: body = system
stack; display = IBM Plex Sans 600; mono = IBM Plex Mono. Layout: grid
`minmax(0,1fr) 300px` (frame · rail); switcher pill fixed at the top with the four scenario
presets.

## Shared store contract (module-level, provider-free, `useProtoState()`)

```
state = {
  scenario: "send" | "take" | "sync" | "edition",
  persona: { name, role, vault },          // whose vault the frame is showing
  profiles: [ { id, label, folder, style, document, noteCount, importedCount,
                packId, packVersion,       // null when the Profile was made by hand
                documentEdited: boolean,   // the recipient edited the installed file (EDITION)
                updateAvailable: null | { version, packId } } ],
  installedStyles: ["apa", "chicago-author-date", "ieee"],   // TAKE: no "chicago-note"
  incoming: {                              // the file/paste/link waiting to be taken in
    filename: "Reading group.md",
    manifest: { id: "anna.reading-group", name, version, author, description,
                filename, profileDefaults: { folder, citationStyle },
                frontmatter: [ 4 entries ], partials: [ { name: "authors", language } ] },
    body,                                  // markdown with {% managed %} and {% annotation %}
    source: "file" | "paste" | "link",
  },
  previewItem,                             // one of the RECIPIENT's own items, for the render
  previewBefore, previewAfter,             // rendered note text at v1.0 / v1.1 (EDITION, SYNC)
  installRecords: { [profileId]: { packId, version, installedAt, files: [ { path, previous } ] } },
  notes: [ { key, title, path, profileId, imported } ],
  activeNoteKey, search, notices: [], log: [],
}
actions = {
  setScenario(id),
  importAsNewProfile(overrides)     // { folder, style } → adds a Profile, records the install
  updateExistingProfile(profileId, { overwriteEdited })   // second edition; logs the count line
  keepMine(profileId),
  revertProfile(profileId),         // to the recorded previous bytes; logs the count line
  removeJustAddedProfile(profileId),// the zero-note delete of #911
  exportProfile(profileId, { bindings, target })  // target: "file" | "clipboard" | "link"
  installStyle(name), openFile(path), notify(text, action), dismissNotice(id), openNote(key),
}
```

Helpers: `profileById`, `stampLabel`, `PROFILE_DISPLAY`, `packLabel(profile)` →
`"Reading group v1.0.0 · from Anna"`, `travellingValues(state)` → the six rows E's ledger and
B's "Your settings" both read.

## Shared primitives contract

Carried over from the #911 gallery unchanged: `Kbd`, `Pill`, `Notice`, `Prompt`, `SuggestRow`,
`Dialog`, `CommandPalette`, `IconButton`, `SettingRow`, `SettingsModal`, `ProfilesPage`,
`ProfilePage`, `Banner`, `SearchPane`, `Rail` / `RailHeading`, `ObsidianFrame` (ribbon, file
tree, tab bar, editor with Properties, status bar, `overlay`, `sidePane`, `statusItems`).

New for this prototype:

- `<FileText path source language="markdown" />` — the exported file rendered as plain text
  in the editor: YAML manifest fenced off from the body, line numbers, so question 2 is
  answerable by looking.
- `<NotePreview title lines diffAgainst={null} />` — a rendered literature note; with
  `diffAgainst` it shows added/removed lines, for the before/after of a second edition.
- `<ManifestHeader manifest />` — name, version, author, description, in the researcher's
  words, with the pack id demoted to mono secondary.
- `<EntersYourVault files fields />` — "what is written" list with per-row verdict pills
  (`new`, `unchanged`, `would overwrite your edit`).
- `<YourSettingsRow label senderValue yourValue onChoose choice />` — one travelling setting;
  B renders two of them as editable fields, E renders six as a radio ledger.
- `<ShareSheet profile onTarget />` — the sender's export menu.

Every `VariantX()` returns
`<div className="grid h-full" style={{gridTemplateColumns:"minmax(0,1fr) 300px"}}> <ObsidianFrame …/> <Rail …/> </div>`,
holds its own UI state, and drives the store through `actions`. Each variant's Rail carries:
the thesis; the four researchers' questions with this variant's one-line answer each; the
numbered steps to try; and the store readout (Profiles with pack id/version, install records,
the incoming file) plus the log.
