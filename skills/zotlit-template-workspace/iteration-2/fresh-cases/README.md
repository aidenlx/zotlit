# Fresh Vault Cases — issue #1093

This manifest defines reset-isolated evaluation cases for the fixed Template
Workbench tasks. It is additive: the historical benchmark and evidence under
`skills/zotlit-template-workspace/iteration-2/` are unchanged, and the three
original trials remain the comparison benchmark. Nothing here claims a
measurement, a grade, or a completed run — every execution status below is
`pending/unverified` until a real Luna trial runs it.

## Vocabulary

- **Vault Case** — a named, saved Fixture Vault state. The nine Workbench cases
  are declared in `packages/scripts/lib/fixture/spec.ts` (`VAULT_CASES`) and
  materialized by `buildFixture`. The generated snapshot of each case lives
  under `tmp/case-snapshots/<case-id>/`.
- **Development Vault** — the per-worktree, per-case Obsidian vault that a
  Paired Run opens. A non-default case uses
  `tests/fixture-vault-<worktree>-<case-id>`.
- **Scope Case** — the saved Library Scope. Every case here uses `all`
  (the default), except that fresh-based cases write no settings file and
  therefore accept only the default Scope Case.

## Fixed environment identity

Identity comes from the live runtime, never from a hardcoded constant.

| Fact | Source at run time |
| --- | --- |
| Zotero source id | `template-status` → `identity.source.id` |
| Zotero database path | `template-status` → `identity.source.databasePath` |
| Vault identity | `template-status` → `identity.vault.name` / `identity.vault.path` |
| CLI contract | `template-status` → `contractVersion` (Contract 7) |
| Plugin version | `template-status` → `zotlitVersion` / `app.plugins.plugins.zotlit.manifest.version` |
| Host version | `template-status` → `hostVersion` |
| Model | recorded by the trial harness, not the plugin |

The historical values `source 8a19f09e` / `vault bd0ea1a22beb8f55` are the
prior environment only. They must never be hardcoded as this environment's
identity.

## Shared reset and snapshot procedure

Each case is rebuilt from the Fixture Spec immediately before a run, and the
candidate and no-skill baseline receive the **same rebuilt initial state**.
Use a fresh agent for every run and every repeat.

1. Reset the generated seed (build-time snapshot):
   ```sh
   pnpm fixture build --vault-case <case-id>
   ```
2. Register/open the per-case Development Vault with a purge (live trials):
   ```sh
   pnpm fixture open --vault-case <case-id> --purge
   ```
   The purge deletes the Development Vault folder and the plugin's
   vault-scoped local storage, then copies the generated seed. For a
   non-default case the vault path is
   `tests/fixture-vault-<worktree>-<case-id>`.
3. Snapshot **BEFORE** the subject prompt:
   - seed: hash the generated files from the completed open/reset operation
     and save a fresh per-case manifest. Keep the paired database unchanged
     while its applications are open; perform the next reset through the
     paired opener before the next run;
   - skill: the `skills/zotlit-template/SKILL.md` bytes in use;
   - CLI contract/help: `obsidian help zotlit:template-check`,
     `obsidian help zotlit:template-inspect`, and
     `template-status` / `template-guide` output;
   - model: trial-harness model and reasoning effort;
   - database/source identity: `template-status` identity block;
   - vault identity: `template-status` vault name/path;
   - installed file hashes: SHA-256 of `templates/zotlit-profile.books.md`,
     `templates/zotlit-partial.book-details.md`,
     `templates/zotlit-citation.md`, the seeded note, and any seeded scratch
     draft (where present);
   - device state: verify that purge cleared the previous vault-scoped state,
     then record the state after startup. The paired opener sets Fixture
     Device Overrides, and startup can initialize new values. Verify that
     these values belong to this run and that prior consent, approved
     attachment folders, and saved view state did not survive.
4. Snapshot **AFTER** the run: the same installed-file hashes, the disk note
   bytes, and any preview output. Installed Profiles, dependencies, notes, and
   settings must be byte-identical to the seed unless the task's prescribed
   solution is explicitly allowed to change a named file (see grading).

Generated snapshots live under `tmp/case-snapshots/` and are distinct from the
registered live Development Vaults under `tests/fixture-vault-*`.

## Sequential execution order

Run cases in this order so shared fixture state is never contended:

1. `workbench-spread`
2. `workbench-yaml-repair` (3 repeats)
3. `workbench-partial-edit`
4. `workbench-citation-variants` (held-out prompt variation)
5. `workbench-update-preservation`
6. `workbench-external-edit` (3 repeats)
7. `workbench-scratch-draft`
8. `workbench-default-no-note` (3 repeats)
9. `workbench-error-recovery` (3 repeats)

Rebuild the seed and purge the Development Vault before every run and every
repeat. Repeat count and held-out variation are run metadata on one Vault
Case; they are not additional Vault Case ids.

## Common grading rules (private — do not show to the subject)

- Assertions are independent of the subject's own report. The grader reads the
  requested output bytes and the retained attempt evidence directly.
- "Preservation" means unrelated files, the caller identity, and the supported
  root are byte-identical to the seed.
- "Freshness" means the check reports `freshness=current` with matching
  requested/disk/loaded revisions, or a documented `SOURCE_NOT_LOADED` /
  `SOURCE_SUPERSEDED` recovery that ends on a current re-check.
- "No preview writes" means a `template-check` (create or update preview)
  writes no Template Document, note, or setting. Only an explicit file-tool
  install may change a named file when the task requires it.
- A stale timeout or refusal is recorded as such and is never accepted as
  success for the external-edit case.
- The grader's expected answer and prescribed solution sequence stay out of the
  subject prompt. The subject receives only the user task.

---

## 1. workbench-spread

- **Base semantics**: `configured`; no seed variation.
- **Target source**: Books Profile `templates/zotlit-profile.books.md`
  (id `V1StGXR8Z5jd`), whose Managed Frontmatter list already contains
  `fixture-title`, `fixture-kind`, `fixture-obsolete`, and one keyless spread.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`, book "Thinking, fast and slow")
  for a real-item create check.
- **User task**: "Add one JSON-e Managed Frontmatter spread to the Books
  Profile that emits `fixture-reviewed: true`, preserve the existing fields and
  the existing Literature Note text, then verify the create result."
- **Controller setup**: none beyond the shared reset. The seed deliberately
  does **not** contain `fixture-reviewed`.
- **Grading**: the checked create output exposes `fixture-reviewed: true`; the
  Books Profile id and caller are explicit; unrelated Profile fields and the
  unchanged note text are preserved; the installed Profile is byte-identical
  to the seed unless the solution was installed; preview writes nothing.

## 2. workbench-yaml-repair

- **Base semantics**: `configured` + `broken-books-profile`. The Books Profile
  manifest edits `name: Books` → `name: 'Books` (one unclosed quote). Body and
  Annotation Section are byte-identical to the valid document.
- **Target source**: `templates/zotlit-profile.books.md`.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`).
- **User task**: "The Books Profile document has one YAML syntax error in its
  manifest. Repair it so the document is valid, preserve every other source
  comment, the body, and the Annotation Section, then check the repaired
  document."
- **Controller setup**: none. The intended invalid state is provable with the
  plugin's own parser before the subject starts: the seeded file fails
  `parseLiteratureNoteTemplate` while the valid document passes.
- **Repeats**: 3 independent repeats.
- **Grading**: the repaired document parses; the only change from the valid
  reference is the repaired quote; body and Annotation Section bytes are
  preserved; a `template-check` on the repaired document passes and the
  installed Profile revision matches disk.

## 3. workbench-partial-edit

- **Base semantics**: `configured`; no seed variation.
- **Target source**: Shared Partial `templates/zotlit-partial.book-details.md`.
- **Caller identity / root**: Books Profile caller, `root=note`.
- **Target Item**: `BKPUBLR4` (`weiBookPublisher2017`, book "A book whose
  Venue is its publisher").
- **User task**: "Make one visible requested text change to the book-details
  Shared Partial. Keep the caller identity, the supported root, and every
  unrelated file unchanged, then check the partial and its Books caller."
- **Controller setup**: none; the seed carries the original partial text.
- **Grading**: the changed text is visible in the checked partial output; the
  Books caller and `root=note` are explicit; unrelated templates/notes are
  byte-identical; the partial's saved revision matches disk.

## 4. workbench-citation-variants

- **Base semantics**: `configured`; no seed variation. The installed
  `templates/zotlit-citation.md` renders `{{ zt.citations | pandoc_cite }}`
  for `main` and
  `cf. {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}` for `alt`.
- **Target source**: Citation Template `templates/zotlit-citation.md`.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`), an explicit real Fixture Item.
- **User task**: "Check both Citation Variants of the installed Citation
  Template against the real Item and report the actual citation bytes for
  each variant."
- **Held-out variation**: `key=BKPUBLR4` (`weiBookPublisher2017`) is the
  held-out Item/prompt variation, kept out of the spread prompt and used only
  when a group needs a second Item.
- **Grading**: `main` and `alt` execute against the same real Item and produce
  visibly distinct citation bytes; both requested/disk/loaded revisions match;
  no Template Document is written.

## 5. workbench-update-preservation

- **Base semantics**: `configured` + `preservation-note`. The stamped Books
  note `books/books-duplicateWithin2020.md` additionally carries the unmanaged
  frontmatter `reader-note: keep-this-sentinel` and hand-written prose outside
  its Managed Region.
- **Target note**: `books/books-duplicateWithin2020.md` (item key `BBBB2222`,
  citekey `duplicateWithin2020`).
- **Target Item for the update**: `BBBB2222` via `mode=update note=...`.
- **User task**: "Run an update check that changes the managed output of this
  stamped Books Literature Note. Prove that the hand-written prose and the
  `reader-note` frontmatter value survive in the preview, and that the note on
  disk is unchanged."
- **Controller setup**: none; the prose and sentinel are seeded.
- **Grading**: the update preview contains the prose and the sentinel value;
  the prose appears outside the Managed Region; the disk note is byte-identical
  to the seed; the changed managed output is inspected, not just reported.

## 6. workbench-external-edit

- **Base semantics**: `configured`; no seed variation. The saved Books Profile
  and its dependency (the Shared Partial) are the baseline.
- **Target source**: Books Profile `templates/zotlit-profile.books.md`; its
  Shared Partial dependency is `templates/zotlit-partial.book-details.md`.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`).
- **User task**: "Inspect the Books Profile, then check the requested new
  revision after an external edit. Report the requested, disk, and loaded
  revisions and do not accept old output."
- **Controller setup** (separate from the subject prompt): after the subject
  completes `template-inspect` and reports the baseline revision, the
  controller edits the Shared Partial file on disk (changes its visible
  `Type` label to `Kind`) using a file tool that Obsidian observes. The subject is
  then told to run the check immediately. State preparation (the baseline) is
  separated from runtime orchestration (the external edit). Completion is
  signalled by the check's own bounded reconciliation of the
  `compile-status-changed` event — no sleep, and no watcher race is promised.
  A `SOURCE_NOT_LOADED` timeout or refusal is recorded as such, never accepted
  as success.
- **Grading**: the run either converges to `freshness=current` with the new
  revision and its visible output, or records a stale timeout/refusal. Matching
  requested/disk/loaded revisions are required before any "success" claim.
  Old output is never accepted as the new revision.

## 7. workbench-scratch-draft

- **Base semantics**: `configured` + `scratch-draft`. The seed also writes a
  complete valid Books draft at `scratch/workbench-draft.md`, outside the
  template folder, with the body heading `# Draft Book profile: {{ zt.title }}`.
- **Target source**: seeded draft `scratch/workbench-draft.md`.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`).
- **User task**: "Check this complete scratch Profile draft for the Fixture
  Item without installing it or changing any existing note."
- **Controller setup**: none; the draft is seeded, not created by the subject.
- **Grading**: the check reports `input.origin=draft` and the draft path; the
  rendered output contains the distinct draft heading; the installed Profile,
  dependencies, notes, and settings are byte-identical to the seed; nothing is
  installed.

## 8. workbench-default-no-note

- **Base semantics**: `fresh`; no settings file, no notes, no ejected
  templates. Only the built-in Default is readable.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`) for create and synthetic-update
  checks.
- **User task**: "In this fresh vault with no settings or notes, check a
  create and a synthetic update for the real Fixture Item using the built-in
  Default Profile. Do not create a note or a custom Profile."
- **Controller setup**: none; the seed has no note or custom Profile.
- **Repeats**: 3 independent repeats.
- **Grading**: the vault holds no settings file, notes, or templates at start
  and end; the create check uses the built-in Default; the synthetic-update
  baseline is reported as synthetic; no file is written.

## 9. workbench-error-recovery

- **Base semantics**: `configured` + `missing-book-details`. The
  `templates/zotlit-partial.book-details.md` file is absent while the Books
  Profile body still calls it, so a create or update check fails until the
  partial is restored.
- **Target source**: Books Profile `templates/zotlit-profile.books.md`; missing
  dependency `book-details`.
- **Target Item**: `NW2CPDTC` (`Kahneman2011`).
- **User task**: "A create/update check for the Books Profile fails because the
  book-details Shared Partial is missing. Record the failing attempt, repair
  the failure, re-check successfully, and retrieve the original failing
  evidence after the repair."
- **Controller setup**: the failure is seeded; the solution (restoring the
  partial) is not.
- **Repeats**: 3 independent repeats.
- **Grading**: the failing attempt is retained and retrievable by its attempt
  id with `evidence=full`; the original failure evidence survives the repair;
  the repaired check passes with the restored partial; the repaired partial is
  byte-identical to the configured reference.

## Status

All nine cases are **pending/unverified**. The seeds and generated snapshots
are implemented and validated by `packages/scripts/lib/fixture/build.test.ts`,
but no Luna trial, repeat, held-out variation, measurement, or grade has been
run or recorded. Historical evaluation artifacts are untouched.
