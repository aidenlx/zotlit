# ZotLit #1086 Template Workbench trial — Luna xhigh, iteration 1

Date: 2026-09-13 (Asia/Singapore)

This report records a fresh-context trial of the candidate `zotlit-template`
skill and the live Obsidian CLI. The trial was read-only. No repository or
vault file was edited by the trial agents.

## Configuration and snapshot

- Model: `gpt-5.6-luna`
- Reasoning: `xhigh`
- Candidate skill: `skills/zotlit-template/SKILL.md`
- Candidate skill SHA-256: `627dd533e078f56a0dbd0dd42eebb22b91981284f17c637ca3c22ef96cbc23bb`
- Pre-implementation CLI snapshot: commit `400d3703a` (`fix(template): make citation walkthrough pass`)
- Mid-trial CLI snapshot: commit `2ca3ba962` (`feat(workbench): inspect documents with verified source revisions (#1087)`)
- Live configured-vault probe: `fixture-vault-zotlit-v2`, plugin `2.1.4`, source ID `8a19f09e`
- Live #1087 probe: `fixture-vault-issue-1087`, plugin `2.1.4`, source ID `3092211e`
- Repository state after trial: branch `codex/issue-1086`; clean working tree apart from the parent agent's landed commit (`2ca3ba962` is one commit ahead of the remote branch).

The branch advanced from `400d3703a` to `2ca3ba962` while the first agent was
running. Results are grouped by the snapshot they observed.

## Fixed tasks and independent outcomes

These prompts were defined from the #1086 spec before running the probes. The
first two were executed by fresh Luna agents. The remaining cases are held-out
tasks for the next implementation snapshot because the current command surface
has no complete check command or mutation-free draft/check path.

| ID | Fixed user prompt | Independently checkable outcome | Result in this iteration |
|---|---|---|---|
| T1 | “Add one JSON-e Managed Frontmatter spread to the Books Profile that emits `fixture-reviewed: true`, preserve the existing fields and note body, and verify the result.” | The selected Books document is identified; the saved source gains exactly one spread; a complete check reports the spread output and unchanged user text; no note write occurs. | Target and source inspection passed. Edit/check completion unverified: no `template-check` command and the trial was read-only. |
| T2 | “Repair the invalid YAML in the Books Profile while preserving all unrelated Markdown bytes, then verify the corrected document.” | Invalid source is inspectable with a precise document/path diagnostic; after a direct file repair, a fresh check reports valid source and matching create/update output. | Unverified: no invalid source was installed and no complete check command exists in the live plugin. |
| T3 | “Change the Books Profile Shared Partial so its rendered line includes the item type, then check both the Profile and its dependency.” | Profile and `partial:book-details` are selected; dependency revisions are current; both rendered outputs contain the requested line. | Dependency inventory/freshness passed under #1087. Mutation and complete check unverified. |
| T4 | “Check both Citation Variants for the Fixture’s Citation Template and tell me exactly what differs.” | `main` and `alt` both execute; output is `[@ioannidisWhyMost2005]` vs `cf. @ioannidisWhyMost2005`; source identity is the same. | Passed live. |
| T5 | “Update the existing Books note and preserve my handwritten paragraph outside the Managed Region.” | A selected note/Profile pair is identified; check exposes update bytes and preservation scope; no note is written during checking. | Note-to-Profile selection and source freshness passed under #1087. Update preservation unverified because no complete check command exists. |
| T6 | “I edited the Profile file externally. Check it, but do not claim success until Obsidian has loaded that exact revision.” | The result either reports matching requested/disk/loaded hashes or returns `SOURCE_NOT_LOADED` with affected paths and versions, and never returns an old preview. | Current loaded-source case passed. Unobserved external edit timeout was unverified. |
| T7 | “Check this scratch draft from `/tmp/books-profile-draft.md`; do not install it or change any existing note.” | Draft origin and revision are reported; output is checked against the draft; installed files and notes are byte-for-byte unchanged. | Unverified: current live plugin has no scratch-file `template-check` path. |
| T8 | “Use the fresh/no-note case and render the built-in Default Profile for a real Fixture Item.” | Default built-in origin is explicit; no document is fabricated; create output is returned and update is `null` only for a static body. | Unverified live: no fresh Vault Case was opened in this run. |
| T9 | “The requested Profile is missing or the source ID changed. Recover without guessing.” | Missing target, source mismatch, and invalid selectors name the condition and provide a next action. | Passed for the available diagnostics. |

## Luna run A — pre-#1087 static/read-only trial

Prompt:

> You are a fresh-context evaluation agent. Read the candidate skill and issue
> #1086 context. Against `fixture-vault-zotlit-v2`, add one JSON-e spread that
> emits `fixture-reviewed=true` while preserving existing frontmatter and note
> body. Start by determining target, source identity, and available CLI commands.
> Use only read-only file tools and Obsidian CLI calls. If the requested new
> commands do not exist, state where the workflow stops. Record calls, errors,
> recovery hints, and completion evidence.

Invocation: `gpt-5.6-luna`, `xhigh`, read-only nested sandbox.

Observed agent metrics: 173,161 tokens; approximately 371 seconds. The nested
sandbox could not reach Obsidian IPC, so every live CLI call returned:

```text
The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.
```

The agent still found the static target:

- Profile: `tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md`, ID `V1StGXR8Z5jd`.
- Existing configured JSON-e spread is present; `fixture-reviewed` is absent.
- The source is structurally supported as `- value: {"fixture-reviewed": true}`.
- `frontmatter-set` edits legacy settings fields; the live guide says to edit Profile document text for spread entries.
- No files were edited.

Agent verdicts:

- Target selection: PASS from static files.
- Source freshness: UNVERIFIED because nested IPC was unavailable; the agent also noted that its static file did not include the current Fixture Spec's `match` line.
- Edit/check completion: UNVERIFIED.
- Recovery: PASS for the host-unavailable message.
- Output disclosure: PASS; the transcript recorded command attempts, stopping point, and limitations.

## Luna run B — live pre-#1087 command trial

Prompt:

> Fresh-context evaluation against the currently open `fixture-vault-zotlit-v2`.
> Read the candidate skill, use the explicit vault prefix on every call, and
> verify the Books Profile and item, inspect source/data, check both Citation
> Template variants, render Profile create/update, test `template-check`, and
> run one invalid `output=all` probe. Do not edit files or run fixture build/open.

Invocation: `gpt-5.6-luna`, `xhigh`, nested sandbox bypassed only to reach the
local Obsidian IPC; the prompt prohibited repository and vault edits.

Observed agent metrics: 36,078 tokens; approximately 120 seconds.

Key transcript:

```text
$ obsidian vault=fixture-vault-zotlit-v2 help zotlit
... template-status, template-data, template-render,
    template-document-render, template-guide, template-source ...
    template-check is not listed

$ ... zotlit:template-status
contractVersion=5, pluginVersion=2.1.4, source.id=8a19f09e
Books Profile=V1StGXR8Z5jd, document=zotlit-profile.books.md

$ ... zotlit:template-source template=note
ok=false, diagnostic.code=INVALID_SELECTOR
Template 'note' is not an active vault-global slot; use template-document-render.

$ ... zotlit:template-data key=AAAAAAAA root=note expect-source=8a19f09e
ok=true, itemType=journalArticle, title='Alpha of the personal library',
citationKey=personalAlpha2024

$ ... zotlit:template-render example=one-item template=citation variant=main ...
ok=true, markdown='[@ioannidisWhyMost2005]'

$ ... zotlit:template-render example=one-item template=citation variant=alt ...
ok=true, markdown='cf. @ioannidisWhyMost2005'

$ ... zotlit:template-document-render key=AAAAAAAA profile=V1StGXR8Z5jd ...
ok=true, render.create contains title + Managed Region;
render.update contains only the Managed Region

$ obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check
Error: Command "zotlit:template-check" not found.

$ ... zotlit:template-status output=all
ok=false, diagnostic.code=INVALID_SELECTOR,
details.parameter=output,
hint='Correct the parameter named in details.parameter, then run the command again.'
```

Agent verdicts: target selection PASS; source freshness PASS for the successful
calls (all carried `8a19f09e`); edit/check completion UNVERIFIED because no edit
was performed and `template-check` was absent; recovery PASS; output disclosure
PASS.

## #1087 inspect probe after the branch advanced

The parent agent landed `2ca3ba962` while the first trial was active. The
current dev build was already installed in the open `fixture-vault-issue-1087`
worktree. This was a direct read-only probe, not a fresh model run.

`help zotlit` lists:

```text
zotlit:template-inspect  [ZotLit]: Inspect a Template Document and verify saved source freshness
```

Inventory command:

```text
obsidian vault=fixture-vault-issue-1087 zotlit:template-inspect
```

Returned `ok=true`, source ID `3092211e`, and four documents:

- Profile `zotlit-profile.books.md`, label `Books`, ID `V1StGXR8Z5jd`, valid.
- Built-in Default Profile, path `null`, no problems.
- Citation Template at `templates/zotlit-citation.md`.
- Shared Partial `partial:book-details` at `templates/zotlit-partial.book-details.md`.

Selected Books inspection:

```text
obsidian vault=fixture-vault-issue-1087 zotlit:template-inspect \
  profile=Books source=full expect-source=3092211e
```

Returned `ok=true`, saved origin, Profile source revision
`7793c556bdc42ddecb5dafa4d0901a04dd7e59d545b8efb271ba81274b6b8032`, and
matching `requested`, `disk`, and `loaded` hashes for the Profile, Citation
Template, and Shared Partial. The dependency scope is
`installed-partial-registry`.

Selected note inspection:

```text
obsidian vault=fixture-vault-issue-1087 zotlit:template-inspect \
  note=books/books-duplicateWithin2020.md expect-source=3092211e
```

Returned the owning Books Profile and note key `BBBB2222`, with the same
current freshness state and all three dependency hashes.

Recovery probes:

| Probe | Result |
|---|---|
| `document=missing-profile.md` | `TARGET_NOT_FOUND`; recovery says to run inventory and use an exact path or Profile ID. |
| `profile=Books expect-source=wrong-source` | `TARGET_MISMATCH`; recovery says to select the intended vault and Zotero source. |
| `profile=Books document=zotlit-profile.books.md` | `INVALID_SELECTOR`; recovery says to select one target. |
| `profile=Books source=full output=all` | `INVALID_SELECTOR`; recovery points to `help zotlit:template-inspect`. |

The candidate skill was unchanged during this probe. Its Literature Note loop
still says to use `template-source` and `template-document-render` after the
initial status/guide calls. The current Guide's data section now documents
`template-inspect`, but the quickstart workflow still presents the older
six-step slot workflow. The skill and quickstart therefore do not yet direct an
agent to the new inspection command for Profile selection or freshness.

## Direct verification and test evidence

- `node packages/scripts/scripts/obsidian-vault.ts check` passed for the open
  issue-1087 host vault.
- `pnpm --filter @zotlit/obsidian test -- src/services/template-workbench/inspect.test.ts`
  ran the package suite: 224 files and 3,665 tests passed in 30.67 seconds.
  The command's argument forwarding selected the full package suite, so this is
  broad regression evidence rather than an inspect-only test count.
- The direct live calls above were all read-only. No source, note, setting, or
  fixture seed changed.

## Findings for the next iteration

1. `template-inspect` now provides the intended target, dependency, and
   source-freshness seam. It gives independently checkable hashes and clear
   recovery diagnostics for target mismatch, missing targets, and ambiguous
   selectors.
2. The candidate skill is stale relative to the landed CLI. Its Profile loop
   must start with `template-inspect` and treat `template-source template=note`
   as invalid for Profile Documents. The skill's contract pin also needs to be
   reviewed whenever the CLI Contract changes.
3. `template-check` is still the central blocker for edit/check completion,
   scratch draft checks, update preservation, and unobserved-source recovery.
   These cases remain unverified and should stay blockers in the evaluation
   until a fresh Luna agent can run them against an installed Fixture build.
4. The live command rejects generic `output=all` on status and inspect. The
   eventual check command needs an explicit, help-documented output selector
   whose compact and selected forms execute the same checks.
5. Run C1–C9 sequentially or in isolated Vault Cases after the check command
   lands. Capture actual changed Profile/Partial bytes, check envelopes,
   source revisions, diagnostics, and no-write assertions before judging the
   skill complete.
