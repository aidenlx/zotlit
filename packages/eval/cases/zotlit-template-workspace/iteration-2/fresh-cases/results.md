# Live trial results — issue #1093 fresh Vault Cases

Environment: Contract 7, plugin 2.1.4, Zotero source `1f2064de`, subject model
claude-sonnet, fresh context per run. Grading reads disk bytes and command
output directly; the subject's own report is never the oracle.

## 1. workbench-spread — candidate — PASS

Seed rebuilt and Development Vault purged before the run. Precondition proven:
`fixture-reviewed` absent from the seed Profile.

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Books Profile id and caller explicit before editing | pass | subject inspected first; check ran with `profile="Books"`, id `V1StGXR8Z5jd` |
| Checked create output exposes `fixture-reviewed: true` | pass | controller re-check on target Item `NW2CPDTC`: `fixture-reviewed: true` |
| Existing fields and note text preserved | pass | pre/post hash diff: only `zotlit-profile.books.md` changed |
| Installed Profile byte-identical unless installed; preview writes nothing | pass | partial, citation template, note, and `data.json` hashes unchanged |

Edit made: exactly one keyless spread appended,
`- value: {"fixture-reviewed": true}`, with the four existing entries
byte-preserved.

Independent freshness oracle: the check reported `state=current` with
requested/disk/loaded all `c1119fb3…f352762a` on the Profile, matching the
controller's own post-run hash of the same file.

### Finding F1 — subject verified against a non-matching Item

The subject ran its create check with `key=BBBB2222`, a `journalArticle`, while
the Books Profile declares `match: 'itemType == "book"'`. The check passed
(create mode does not enforce the match rule), but the inspected evidence came
from an Item class the Profile does not select, and the subject explained away
the resulting `fixture-obsolete: missing` rather than re-checking on a book.

Two contributing causes, both real:

- The eval prompt does not pin the target Item, though the manifest names
  `NW2CPDTC` as this case's target.
- Skill step 4 says only "Run `template-check` against a relevant Item"; it
  does not say the Item should satisfy the Profile's `match` rule.

Severity: the task outcome was still correct here. Recorded for the iteration
report; a skill-wording fix is considered once more cases report, so the change
answers observed failures across the matrix rather than one run.

## Harness defect H1 — subject reached the grader's manifest (found and fixed)

The first no-skill baseline for `workbench-spread` was **discarded as invalid**.
A transcript audit found it had opened files it must never see:

| Path probed in transcript | Hits | Meaning |
| --- | --- | --- |
| `skills/zotlit-template/SKILL` | 3 | the "no-skill" arm read the candidate skill |
| `skills/zotlit-template-workspace/.../fresh-cases/README` | 3 | read the private grading rules and prescribed solutions |
| `iteration-2` | 4 | read the design history |

Cause is structural, not a subject mistake: `skills/zotlit-template/` sits
directly beside `skills/zotlit-template-workspace/`, so a subject that explores
the skill folder walks into the grader's manifest next door. This breaks the
ticket's requirement to keep design history, prescribed solutions, and grader
expectations out of trial context, and it destroys the no-skill contrast.

Fix applied before any further trial:

1. The candidate arm reads an **isolated copy** of `SKILL.md` placed outside the
   repository (sha256 `91833f92…5763bdf5`, identical to the committed file), so
   no sibling manifest is reachable from it.
2. Every subject prompt scopes the task to the Development Vault folder and
   states that files outside it — `skills/`, `docs/`, `packages/`, `apps/` — are
   out of scope.
3. A **contamination gate** now runs on every trial: the transcript is probed
   for manifest, workspace, and (for baseline runs) skill paths. Any hit
   discards the run and it is re-run after a fresh reset.

The `workbench-spread` candidate run predates the hardened prompt but **passed
the contamination gate** (0 manifest hits; its 3 skill hits are the intended
read), so it stands. The baseline was re-run from a verified-identical seed
(`99d3f5f5…`).

## 1. workbench-spread — no-skill baseline (isolated re-run) — PASS

Contamination gate: 0 hits on manifest, workspace, skill, and design-history
paths. Seed verified identical to the candidate's seed (`99d3f5f5…`) before the
run.

Both arms converged on a **byte-identical final Profile** (`c1119fb3…`): the
same single keyless spread `- value: {"fixture-reviewed": true}`. Only that file
changed; partial, citation template, note, and `data.json` hashes unchanged.

### Comparison for this case

| | candidate (with skill) | baseline (no skill) |
| --- | --- | --- |
| Final Profile bytes | `c1119fb3…` | `c1119fb3…` (identical) |
| Preservation | pass | pass |
| No preview writes | pass | pass |
| Item used to verify | `BBBB2222` — a `journalArticle` | `BKPUBLR4` — a `book` |
| Extra verification | create only | create **and** update-mode fold |

The skill produced **no measurable advantage on this case**, and on Item choice
the baseline was the stronger run: it picked an Item satisfying the Profile's
`match: itemType == "book"` rule, while the skill-guided candidate did not, and
it additionally exercised the update fold to demonstrate preservation.

This sharpens finding F1. The skill's step 4 wording — "Run `template-check`
against a relevant Item" — did not steer the candidate toward an Item the
Profile actually selects, and an unguided subject did better unaided. Held for
the iteration decision rather than patched from a single case.

## Harness defect H2 — subjects were pointed at the personal Zotero library (found and fixed)

The first `workbench-yaml-repair` candidate run was **discarded as invalid**.

**Corrected diagnosis.** My first reading of this was wrong. I recorded it as a
"truncated database" because `zotlit:library-scope` reported only 1 available
Library instead of 4. Reading the generated SQLite file directly disproved that:
it holds all four Libraries (`libraryID` 1-4). The real cause is different and
more serious.

A purge removes the plugin's **vault-scoped Device Overrides**, which carry the
Zotero database path. Only the paired **opener** repopulates them. A purge
followed by a plain `sync` therefore leaves the plugin with no override, and it
falls back to the default location — the machine's **personal** Zotero database:

| | correct Fixture run | defective run |
| --- | --- | --- |
| `identity.source.databasePath` | `tmp/acceptance-fixture/zotero-data/zotero.sqlite` | `/Users/aidenlx/Zotero/zotero.sqlite` |
| `identity.source.id` | `1f2064de` | `2d165fa1` |
| Libraries available | 4 | 1 |
| `NW2CPDTC` / `BKPUBLR4` / `BBBB2222` | resolve | `KEY_NOT_FOUND` |

So the discarded subject was not reading a damaged Fixture; it was reading the
user's real Zotero library, where the Fixture Item keys do not exist. It met
`KEY_NOT_FOUND`, reasonably concluded the Item was unavailable, and substituted
an unrelated **thesis** (`I49R3FTL`). Its repair was sound, but its evidence came
from the wrong database entirely, so the run cannot be graded.

Fixes applied:

1. Resets use the **opener** (`obsidian-vault.ts open --vault-case <id> --purge`),
   which repopulates the Fixture Device Overrides after the purge. A plain
   `sync --purge` is not a valid reset for this matrix.
2. The environment gate now asserts the decisive fact — that
   `identity.source.databasePath` points inside `acceptance-fixture` — and fails
   closed before any subject is dispatched. It also requires 4 Libraries and all
   three target Items resolving.
3. The intermittent hang that led me to stop the opener mid-run was caused by
   stale `obsidian-vault.ts` processes left from an earlier interrupted run, not
   by the opener itself. Clearing those removed the hang.

Zotero itself is still not launched: Obsidian plus the generated SQLite database
serves the whole matrix, and `template-data` resolves real Item data with no
Zotero process running.

All graded runs are confirmed to have used source `1f2064de` on the
`acceptance-fixture` database.

### Independent oracle for this case

Applying the intended repair to the seed reproduces the configured Profile
exactly: `name: 'Books` → `name: Books` yields sha256 `99d3f5f5…`, the byte-identical
valid Books Profile observed as the `workbench-spread` seed. Closing the quote
instead (`name: 'Books'`) yields `c6d37c39…`. Both are valid minimal repairs and
both are accepted; every other byte must match the seed.

## 2. workbench-yaml-repair — candidate

Environment gate passed before every repeat (4 Libraries; `NW2CPDTC`,
`BKPUBLR4`, `BBBB2222` all resolving). Seed is deterministic at sha256
`5f2e8fb7…`; the clean build mints source id `1f2064de` every time.

`expect-source` was independently confirmed to be enforced: a bogus id returns
`ok:false` with `"code":"TARGET_MISMATCH"`, so a subject cannot pass this check
against a stale source by accident.

### Repeat 1 — PASS

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Seeded file proven invalid before the run | pass | plugin parser: `validation.state=invalid`, `invalid-profile-document` |
| Repaired document parses | pass | `state=valid`, `profileDiagnostics: []` |
| Only change is the repaired quote | pass | result byte-identical to the independently built reference `c6d37c39…` |
| Body and Annotation Section bytes preserved | pass | same byte-identity; reference differs from seed only at line 3 |
| Check passes with matching saved revision | pass | `ok:true`, all components `passed` |

Repair chosen: `name: 'Books` → `name: 'Books'`. Only the Profile file changed.
Contamination gate: PASS.

### Repeats 2 and 3 — PASS (identical)

Both repeats produced the **same bytes** as repeat 1 (`c6d37c39…`, identical to
the independently built reference), with `state=valid`, zero diagnostics, all
check components `passed`, and no other file touched. Contamination gate: PASS
on both.

**Failure-sensitivity result: 3/3 identical.** This case shows no variance
across repeats; the repair is reproducible under reset isolation.

### No-skill baseline — PASS

Identical outcome to all three candidate repeats (`c6d37c39…`), `state=valid`,
all components `passed`, only the Profile changed. Contamination gate: PASS.

**Case 2 comparison: no measurable skill advantage.** Candidate and baseline
converged on the same minimal repair. Both arms also reported the same honest
limitation unprompted — the Annotation Section's *rendered* output could not be
exercised because no Fixture Item carries annotation data — which is a real
coverage gap in the case design, not a subject failure.

## Eval-design fix E1 — `workbench-partial-edit` had no gradeable expected value

The manifest prompt asked for "one visible requested text change" without
naming the change, so no independent oracle could exist: any edit would satisfy
"the changed text is visible in the checked partial output". The handoff flagged
this class of wording ahead of time — every requested visible edit needs a
concrete expected value.

Pinned before collecting any evidence, and recorded here as the change to the
manifest:

> In the book-details Shared Partial, change the callout title from
> `Book details` to `Book summary`.

The seed partial is six lines:

```
---
language: liquid
---
> [!info] Book details
> Type: {{ zt.itemType }}
> Citation key: {{ zt.citationKey | default: zt.key }}
```

`Book details` is chosen over the `Type:` label deliberately: `Type` → `Kind` is
the controller's external edit in `workbench-external-edit`, and reusing it here
would blur two cases that must stay distinguishable.

The case's intent is unchanged — one visible text edit to the Shared Partial,
checked through the Books caller at `root=note`.

## 3. workbench-partial-edit — candidate — PASS

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Changed text visible in the checked partial output | pass | controller check on `BKPUBLR4`: `> [!info] Book summary` |
| Books caller and `root=note` explicit | pass | check ran `document=partial:book-details root=note profile=V1StGXR8Z5jd` |
| Unrelated templates and notes byte-identical | pass | only the partial's hash moved (`9db8c823…` → `46094dd1…`) |
| Partial's saved revision matches disk | pass | `state=current`, requested=disk=loaded=`46094dd1`, equal to the controller's own disk hash |

The edit was exactly the pinned one — a single line, `Book details` →
`Book summary`. The candidate also verified through the Books caller in update
mode against the real note, and used a **book** Item, unlike case 1.
Contamination gate: PASS.

### No-skill baseline — PASS

Byte-identical result to the candidate (`46094dd1…`), same single-line edit,
nothing else touched. Contamination gate: PASS.

**Case 3 comparison: no measurable skill advantage.** The baseline reached
`zotlit:template-guide topic=partials` from `obsidian help` alone and quoted the
guide's own statement that a Shared Partial has no data root of its own — the
caller sets it. It also caught a subtlety the case design does not assert: the
stored note `books/books-duplicateWithin2020.md` still contains a previously
rendered copy of the old callout text, and it correctly left that file alone as
out of scope.

This is the CLI + skill pair policy working as intended: the tooling facts lived
in the CLI's help and guide, and an unguided agent found them.

## 4. workbench-citation-variants — candidate — PASS

Read-only case. Target Item `NW2CPDTC` named in the prompt so the reported bytes
are gradeable.

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Both variants execute against the same real Item | pass | both checks ran `document=citation key=NW2CPDTC`, one source revision |
| Variants produce visibly distinct citation bytes | pass | controller reproduction below |
| Requested/disk/loaded revisions match | pass | `freshness.state=current` on the template and its partial dependency |
| No Template Document written | pass | pre/post hash diff empty — **nothing written** |

Controller reproduction, run independently of the subject:

| Variant | Citation bytes |
| --- | --- |
| `main` | `[@Kahneman2011]` |
| `alt` | `cf. @Kahneman2011` |

These match the subject's report exactly. Contamination gate: PASS.

### Held-out variation (`key=BKPUBLR4`) — PASS

Controller reproduction on the held-out Item:

| Variant | Citation bytes |
| --- | --- |
| `main` | `[@weiBookPublisher2017]` |
| `alt` | `cf. @weiBookPublisher2017` |

Distinct, current on all revisions, nothing written. The held-out Item
generalises the case: the variant contrast is not specific to `NW2CPDTC`.
Contamination gate: PASS.

### Finding F2 — a citation check rejects the selector the general help implies

The held-out subject first ran `root=citation`, taking the value from the
general CLI help's root list (`root=<note|annotation|filename|citation>`), and
got:

```
"code":"INVALID_SELECTOR"
Profile checks select item data with key.
```

Reproduced independently by the controller. The correct form for a Citation
Template check is `document=citation`; `root=citation` is valid for
`template-data` but not for a `template-check` of the installed Citation
Template. The subject recovered only after reading
`template-guide topic=citations`.

The diagnostic is accurate but **not corrective**: it states what profile checks
do, and never names the selector that would work. Under the
[CLI + skill pair policy](../../../../policies/cli-skill-pair.md) this belongs in the
CLI, not the skill — "diagnostic hints travel inside the error envelope —
corrective guidance at failure time". A hint naming `document=citation` would
have removed the failed call entirely.

Recorded as a CLI change candidate. Cost observed: one invalid call plus one
extra guide read per affected run.

### No-skill baseline — PASS

Same bytes as the candidate (`[@Kahneman2011]` / `cf. @Kahneman2011`), same
current revisions, nothing written.

**Case 4 comparison: no measurable skill advantage, and one point against the
skill.** The baseline used the correct `document=citation` selector on its first
call. The skill-guided held-out run did not, and spent an invalid call plus a
guide read recovering (F2). The skill's step 4 — "Run `template-check` against a
relevant Item" — does not distinguish the Citation Template's selector from the
`root=` values the general help lists.

## 5. workbench-update-preservation — candidate — PASS

Precondition seeded and verified: `reader-note: keep-this-sentinel` in unmanaged
frontmatter, plus hand-written prose below the managed region.

The subject made the managed output differ by adding one line to the Shared
Partial (`> Publisher: {{ zt.publisher | default: "Unknown" }}`), then ran the
update check.

Controller verification, computed directly from the check's own output rather
than the subject's report:

| Assertion | Verdict |
| --- | --- |
| Sentinel `reader-note: keep-this-sentinel` survives in the preview frontmatter | pass |
| Hand-written prose survives in the preview body | pass |
| Prose appears **outside** (after) the managed region | pass |
| Changed managed output (`Publisher: Unknown`) present and **inside** the managed region | pass |
| Note on disk byte-identical to the seed | pass |

Only `zotlit-partial.book-details.md` changed on disk. Contamination gate: PASS.

### F2 second occurrence — `root=` rejected by a Profile check

This subject also lost a call to `root=note` on a Profile check:

```
"code":"INVALID_SELECTOR"
Profile checks select item data with key.
```

Reproduced independently. Note that `root=note` **is** valid when checking a
Shared Partial (case 3 used it successfully) and for `template-data`, but a
Profile or Citation Template check rejects it — with the same non-corrective
hint in all cases.

Two independent subjects have now paid for this, on two different command
shapes. The hint names neither the selector to use nor the fact that `root`
belongs to partial and data calls. This raises F2 from a single observation to a
**repeated, cross-case failure**, and it is a CLI fix by policy.

### No-skill baseline — PASS

Same outcome: note byte-identical on disk, sentinel and prose preserved in the
preview, only the Shared Partial changed (`bdb9d490…`).

**Case 5 comparison: the baseline produced stronger evidence.** It ran the
update check **before** its edit as well as after, so it could show the managed
line actually changing (`> Type:` → `> Item type:`) rather than only asserting
the post-state. It also made no invalid call, while the candidate lost one to
`root=note` (F2).

## 6. workbench-external-edit — candidate

Two-phase case. The subject inspects and reports a baseline, the **controller**
then edits the Shared Partial on disk with a real file write (`> Type: ` →
`> Kind: `), and the subject is resumed and told the edit is saved. State
preparation and runtime orchestration stay separate, and the subject never sees
the grading rules.

### Repeat 1 — PASS (converged)

Baseline reported in phase one matched the controller's snapshot exactly:
Profile `99d3f5f5…`, Citation `33160426…`, partial `9db8c823…`, all `current`.

Controller edit moved the partial to `9eedb3a00c1ccc66…`.

Controller verification after the run:

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Converges to `freshness=current` with the new revision | pass | `freshness.state=current` |
| requested / disk / loaded all match the new revision | pass | all three `9eedb3a00c1c…` |
| The new revision's visible output is reported | pass | body contains `> Kind: book` |
| Old output never accepted as the new revision | pass | body contains **no** `> Type: ` |

Convergence came from the check's own bounded reconciliation — no sleep was used
and none was needed. The subject also correctly identified that the edit landed
on the **dependency**, not the Profile, and said so, rather than assuming the
Profile had changed.

One small inaccuracy in its narration: it attributed the `## Book details`
heading to the partial when that heading comes from the Profile body. This did
not affect any assertion — the graded evidence is the `Kind:` line and the
revision triple.

### Repeats 2 and 3 — PASS (converged)

Both repeats reproduced repeat 1 exactly: baseline `9db8c823…` in phase one,
controller edit to `9eedb3a00c1c…`, then `freshness.state=current` with
requested/disk/loaded all equal to the new revision, body containing
`> Kind: book` and no `> Type: `. Contamination gates: PASS.

**Failure-sensitivity result: 3/3 converged. No stale timeout, no
`SOURCE_NOT_LOADED`, and no refusal was observed in any repeat.** This is the
outcome the case was built to be able to falsify, and it held under three
independent resets against a real controlled file write.

Both later repeats volunteered the same honest limitation: having captured no
pre-edit *render*, they could not show a byte-level before/after of the visible
label and said so, resting the claim on the revision triple instead. That is the
correct call, and it points at a small improvement to the case design — phase one
could capture a render as well as an inspect, making the visible-text change
directly demonstrable.

### No-skill baseline — PASS (converged)

Same convergence: partial at `9eedb3a0…` with requested/disk/loaded equal,
`freshness.state=current`, body carrying `> Kind: book`, and an explicit "I did
not encounter a stale-cache condition; nothing here needed a retry."

**Case 6 comparison: no measurable skill advantage; the freshness machinery, not
the skill, is what carries this case.** All four runs converged on the real
external write.

### Shared weakness W1 — subjects cannot name *which* text changed

Three of the four runs correctly proved the **new revision** was loaded, but
could not say which visible label changed, because phase one captures only an
inspect and never a render. Two candidates said so honestly. The baseline went
further and guessed wrong: it proposed that one of the two visible
`Book details` labels was the edited one, when the actual controller edit was
`> Type: ` → `> Kind: `.

The guess did not change the verdict — the graded assertions are the revision
triple and the presence of `> Kind: ` — but a confident wrong attribution is
exactly the false-completion shape this matrix exists to catch. The fix belongs
in the case design, not the product: phase one should capture a render as well
as an inspect, so the before/after of the visible text is provable.

## 7. workbench-scratch-draft — candidate — PASS

| Assertion | Verdict | Evidence (controller-reproduced) |
| --- | --- | --- |
| Check reports `input.origin=draft` and the draft path | pass | `origin: draft`, `path: scratch/workbench-draft.md` |
| Rendered output contains the distinct draft heading | pass | `# Draft Book profile: Thinking, fast and slow` |
| Installed Profile, dependencies, notes, settings byte-identical | pass | pre/post hash diff empty across every tracked file |
| Nothing installed | pass | `templates/` still holds exactly its three seeded files |

The draft shares the installed Profile's id (`V1StGXR8Z5jd`) and still checked
cleanly as a draft without being installed. The subject also flagged, correctly
and unprompted, that it had not diffed the draft against the installed Profile
of the same id — an accurate statement of what it did not do.
Contamination gate: PASS.

### No-skill baseline — PASS

Same outcome: `input.origin=draft`, distinct draft heading rendered, nothing
installed, `templates/` unchanged, all tracked hashes identical.

**Case 7 comparison: no measurable skill advantage.** The baseline found
`draft=<absolute-path>` from `template-guide topic=check` on its own.

## Finding W2 — every subject reached for `git status` as a preservation oracle

Measured across all ten graded transcripts (candidate and baseline alike):
**10 of 10 runs invoked `git status` or `git diff` on the Development Vault to
support a "nothing changed" claim.** The vault is matched by `.gitignore`
(`tests/fixture-vault-*/`), so git reports clean unconditionally — the check is
**vacuous**, and a clean result is not evidence of anything.

Behaviour split:

- Most runs noticed the vault was ignored and fell back to real evidence —
  re-reading bytes, `shasum -a 256`, or the tool's own `baseline.revision`.
- At least one run (case 7 baseline) presented `git status --porcelain: clean`
  as a positive no-change finding before admitting it could not hash-compare the
  installed Profile.

Nothing was actually graded wrong, because the controller grades from its own
pre/post hashes. But a vacuous check offered as proof is precisely the
false-completion shape this matrix is meant to surface, and it recurred in
**every single run** — the most consistent behaviour observed in the whole
matrix.

This is **process**, not a tooling fact, so by the
[CLI + skill pair policy](../../../../policies/cli-skill-pair.md) it belongs in the
skill rather than in command help. The skill already says to inspect output
before declaring a change complete; it does not say what counts as evidence that
an unrelated file was preserved. Candidate wording is proposed in the iteration
section below.

## 8. workbench-default-no-note — candidate — PASS 3/3

Precondition verified, and one manifest wording corrected in the process.

**Correction to the case's stated precondition.** The manifest asserts the fresh
vault holds "no settings file" at start and end. Literally read, that is false
and would fail every run: `.obsidian/plugins/zotlit/data.json` exists. Checking
the generated seed settles it — the seed writes **no** `data.json` at all; the
file is created by plugin startup and contains only:

```json
{ "__VERSION__": 10, "release.previous-version": "2.1.4" }
```

No user settings, no Profile configuration. This is exactly the distinction the
handoff warned about: an empty generated fresh seed versus settings initialized
by plugin startup. The assertion should read: *the seed carries no settings file,
and startup writes only a version marker — no user settings or Profile config
appears.* Graded on that basis.

| Assertion | r1 | r2 | r3 | Evidence |
| --- | --- | --- | --- | --- |
| No notes or ejected templates at start and end | pass | pass | pass | 0 `.md` files; `templates/` absent throughout |
| Create check uses the built-in Default | pass | pass | pass | `profile=default`, filename `Kahneman2011` |
| Synthetic-update baseline reported as synthetic | pass | pass | pass | `baseline.kind: "synthetic"`, `path: null`, `revision: null` |
| No file written | pass | pass | pass | pre/post hash diff empty on all three |

**Failure-sensitivity result: 3/3 identical.** All three produced byte-identical
create and update output and all three named the synthetic baseline explicitly
rather than claiming an update against a note that does not exist — the
false-completion this case exists to catch.

### No-skill baseline — PASS

Identical create and update output, same explicit synthetic baseline, nothing
written, `templates/` still absent.

**Case 8 comparison: no measurable skill advantage.** Both arms named the
synthetic baseline correctly and neither invented an update against a
non-existent note.

## 9. workbench-error-recovery — candidate

Precondition verified before the run: `templates/` holds only the Profile and
Citation Template, the partial is absent, and a live check fails (`ok:false`,
attempt `45fd2676…` captured by the controller).

### Repeat 1 — PASS on recovery; one manifest assertion is unsatisfiable

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Failing attempt retained and retrievable by id with `evidence=full` | pass | see independent check below |
| Original failure evidence survives the repair | pass | controller's own pre-run attempt `45fd2676…` still returns `ok:false` after the repair |
| Repaired check passes with the restored partial | pass | live check now `ok:true` |
| Repaired partial byte-identical to the configured reference | **fail — assertion unsatisfiable** | `342c57e3…` vs reference `9db8c823…` |

The strongest evidence here is the controller's own oracle: attempt `45fd2676…`
was captured **before the subject started** and was never touched by it. After
the repair, retrieving it still yields `ok:false`, while the live check yields
`ok:true`. Retained failure evidence is immutable across a repair — proven
without relying on the subject's own attempt id.

### Eval-design defect E2 — "byte-identical to the configured reference" cannot be met

The case deletes the Shared Partial, then asks the subject to repair the
failure. The subject must therefore **reconstruct a file whose original bytes no
longer exist anywhere in the vault**. The restored file differed from the
reference in exactly one token:

```
reference: > Citation key: {{ zt.citationKey | default: zt.key }}
restored : > Citation key: {{ zt.citationKey }}
```

The only surviving trace of the deleted partial is the rendered copy inside
`books/books-duplicateWithin2020.md`, which reads
`Citation key: duplicateWithin2020` — **identical under both forms**, because
that Item has a citation key. No available evidence distinguishes them.

So the assertion demands information the case design destroys. It should be
replaced with a behavioural assertion, e.g. *the restored partial renders the
same visible output for an Item with a citation key, and the subject states any
fallback behaviour it could not recover*. Recorded as a manifest fix, not a
subject failure.

Worth noting the difference is real, not cosmetic: for an Item with **no**
citation key the reference falls back to `zt.key` and the restored version
renders empty. The subject did not discover this, and nothing in the case
prompted it to.

## Harness defect H3 — repeat 2 inherited repeat 1's state (found, diagnosed, fixed)

The first `workbench-error-recovery` repeat 2 was **discarded as invalid**, and
it exposed the only genuine break in reset isolation found in this matrix.

Repeat 2 failed with a **different diagnostic** from repeat 1:

| Run | Diagnostic at start |
| --- | --- |
| repeat 1 | `missing-partial` / `MissingTemplateError` (intended) |
| repeat 2 | `SOURCE_NOT_LOADED`, with `requested: null`, `disk: null`, `loaded: 342c57e3…` |

That `loaded` value is decisive: `342c57e3…` is the exact sha256 of the Shared
Partial **repeat 1 created**. Repeat 2 did not start from the seed; it started
carrying repeat 1's artefact in the plugin's loaded registry.

The leak survived a purge, a re-sync, a re-open, **and** a plugin
disable/enable. It is not recorded in `data.json` — neither the seed's nor the
Development Vault's mentions the partial — so it lives in vault-scoped state the
running Obsidian process holds and rewrites, which a purge cannot reach while the
app is running.

### This is a harness artefact, not a product defect

Tested directly, and the product came out clean:

| Action while Obsidian is running | Diagnostic |
| --- | --- |
| Restore the partial | `ok: true` |
| Delete the partial with a normal file operation | `missing-partial` — correct |

So ZotLit reconciles an externally **deleted** dependency correctly, exactly as
it reconciles an externally **edited** one in case 6. The stale state comes only
from the purge replacing the whole vault folder underneath a running app, which
Obsidian never sees as per-file events.

### Fix

`tmp/fresh-cases-runs/settle-missing-partial.sh` runs after the purge for this
case: it recreates the partial, deletes it again through a real file operation
so the running app observes a genuine deletion, then **gates** on the resulting
diagnostic being `missing-partial` before any subject is dispatched.

### Consequence for the other cases

This class of leak only bites a case whose precondition is an **absent** file.
Every other case seeds files that are present, and their preconditions were
verified by hash after each reset (seed hashes reproduced exactly every time).
No other case shows evidence of cross-run inheritance.

### Repeats 2 (re-run) and 3 — PASS on recovery

Both ran from a gated `missing-partial` precondition and reproduced repeat 1's
recovery behaviour:

| Assertion | r1 | r2 | r3 |
| --- | --- | --- | --- |
| Failing attempt retained and retrievable with `evidence=full` | pass | pass | pass |
| Original failure evidence survives the repair | pass | pass | pass |
| Repaired check passes with the restored partial | pass | pass | pass |
| Repaired partial byte-identical to reference | n/a — E2 | n/a — E2 | n/a — E2 |

**Failure-sensitivity result: 3/3 recovered**, and every repeat retrieved its
original failing attempt unchanged after the repair. Repeat 3 additionally noted
the retention window ("last 32 attempts"), which it read from the guide.

**Variance across repeats — the reconstructed file differed every time:**

| Run | Restored partial | Difference |
| --- | --- | --- |
| r1 | `342c57e3…` | kept `language: liquid` frontmatter; dropped `\| default: zt.key` |
| r2 | `53de8ec0…` | dropped the frontmatter **and** the filter |
| r3 | (same shape as r2) | dropped the frontmatter and the filter |

All three passed every check. This is the clearest evidence for E2: with the
original bytes destroyed, three independent subjects produced three variants,
none byte-identical to the reference, and the product accepted all of them. The
assertion must become behavioural.

### No-skill baseline — PASS

Same recovery path: both create and update attempts retained, repaired by
recreating the partial, re-check `ok:true`, and both original failing attempts
retrieved intact afterwards. It also quoted the Shared Partial naming rule
(`zotlit-partial.<name>.md`) from the guide, and reconstructed the same
frontmatter-less content as repeats 2 and 3.

**Case 9 comparison: no measurable skill advantage.** The baseline found the
retained-attempt lookup contract and the partial naming rule from the CLI's own
guide.

# Iteration: refinements and regression reruns

Two changes were made, each answering a repeated, measured failure — never a
single observation. The CLI Contract version is unchanged (7), so the skill's
contract pin stays at 7 as the CLI + skill pair policy requires.

## Change 1 — CLI: make the `INVALID_SELECTOR` hint corrective (F2)

`apps/obsidian/src/services/template-workbench/check.ts`. The profile-check
selector rejection carried the message "Profile checks select item data with
key." and inherited the generic hint "Correct the parameter named in
details.parameter" — a parameter this call site never populates. Added a
`recovery` naming the working selectors:

> Use key to select item data. Check the Citation Template with
> document=citation, and reserve root for template-data and Shared Partial
> checks.

This is a tooling fact, so it belongs in the error envelope, not the skill.

## Change 2 — skill: Item choice and preservation evidence (F1, W2)

`skills/zotlit-template/SKILL.md`, 3029 → 3330 bytes. Two edits, both process:

- Step 4: "against a relevant Item" → "against an Item the source's own `match`
  rule selects, or against an existing Literature Note."
- Step 5, added: "Prove preservation with bytes: hash an unrelated file before
  and after, or compare it against the revision the check reports. Bytes are the
  evidence, because a vault often sits outside version control, where a
  repository status reads clean whatever happened."

The preservation line is phrased affirmatively — it names the evidence to
produce, with the vacuous-check warning attached as the reason rather than as a
prohibition.

## Regression: workbench-spread, fresh subject, final bundle — PASS

Same seed (`99d3f5f5…`), same resulting Profile (`c1119fb3…`) as the original
candidate: **the answer did not change**. What changed is the verification, and
both refinements fired:

| Behaviour | Before refinement | After refinement |
| --- | --- | --- |
| Item chosen to verify | `BBBB2222`, a `journalArticle` | `BKPUBLR4`, confirmed `book` via `template-data` |
| Stated reason | none | "satisfies the Books Profile's own `match: 'itemType == "book"'` rule" |
| Preservation evidence | prose assertion + file read | sha256 of the body before and after, both `e4ade73f…` |
| Git oracle | used without qualification | "git-ignored … so a clean `git status` would not prove anything — bytes are the only evidence" |

This is the first measurable skill effect in the matrix: the subject verified
against a matching Item **and** rejected the vacuous git oracle by name before
producing byte evidence.

## Regression: workbench-update-preservation, fresh subject, final bundle — PASS

Same assertions as before, all met: sentinel and prose survive in the preview,
prose sits after the managed region, the new managed line
(`> Container: Journal of Personal Records`) sits inside it, and the note on
disk is byte-identical.

Evidence quality improved, **partially**: the run used `shasum` three times
against one `git status` call, making bytes the primary oracle and matching the
disk hash to the check's own `baseline.revision`. It did still reach for git
once. So the W2 wording moved the behaviour without eliminating the reflex —
recorded as measured, not as solved.

## Regression: workbench-citation-variants, fresh subject, final bundle — PASS

Same bytes as the original run (`[@Kahneman2011]` / `cf. @Kahneman2011`), same
current revisions, nothing written. **No failed command and no retry** — the run
used `document=citation` directly. The F2 hint did not need to fire here; it
remains in place for the case that produced the original failure.

## Regression set summary

| Rerun case | Result | Answer changed? |
| --- | --- | --- |
| workbench-spread | PASS | no — same Profile bytes `c1119fb3…` |
| workbench-update-preservation | PASS | no — same preservation outcome |
| workbench-citation-variants | PASS | no — same citation bytes |

Full suite after the changes: **225 test files / 3747 tests passed**, identical
to the pre-change baseline. `pnpm lint` clean, with only the repo's
pre-existing warnings. CLI Contract remains 7; the skill's pin remains 7.

# Post-review re-runs: the trimmed skill

An independent standards review found that step 5's new preservation sentence
carried its rationale inside the spec body, against the Affirmative specs rule
in `AGENTS.md`. The rationale moved to the report and the skill kept only the
actionable requirement:

> Prove preservation with bytes: hash an unrelated file before and after, or
> compare it against the revision the check reports.

`skills/zotlit-template/SKILL.md` is now **3197 bytes**, sha256
`6bc29930…541659` (3330 before the trim). Because that edit changed the bytes
the regression set measured, the two cases whose evidence depended on the
trimmed clause were run again from a fresh reset, with fresh subjects reading
an isolated copy of the trimmed skill.

Both resets reproduced the matrix seed exactly (`99d3f5f5…`) and passed the
environment gate: Fixture database, 4 Libraries, `NW2CPDTC` / `BKPUBLR4` /
`BBBB2222` all resolving, source `1f2064de`.

## Re-run 1 — workbench-spread — PASS

| Assertion | Verdict | Evidence |
| --- | --- | --- |
| Books Profile id and caller explicit before editing | pass | check ran `profile=Books`, id `V1StGXR8Z5jd` |
| Checked create output exposes `fixture-reviewed: true` | pass | controller re-check on the case target `NW2CPDTC`, a book: `fixture-reviewed: true` with the four prior fields intact |
| Existing fields and note text preserved | pass | pre/post hash diff: only `zotlit-profile.books.md` changed |
| Installed Profile byte-identical unless installed; preview writes nothing | pass | partial, citation template, note, and `data.json` hashes unchanged |

Freshness was `current` with requested/disk/loaded all `c0ccb4af…`, matching
the controller's own post-run hash. Contamination gate: PASS.

**The answer differs from the original candidate in whitespace only.** This run
wrote `- value: {"fixture-reviewed":true}` (`c0ccb4af…`); the original wrote
`- value: {"fixture-reviewed": true}` (`c1119fb3…`). Same single keyless
spread, same rendered field, one space apart.

**F1 recurred.** The subject ran its create check with `key=BBBB2222`, a
`journalArticle`, while the Books Profile declares `match: 'itemType ==
"book"'`. It did run its update check against the existing Literature Note,
which step 4's second clause permits, so the wording was satisfied by that
branch rather than by Item choice. The earlier post-refinement run chose a book
and named the rule; this one did not. Recorded as measured: **the step 4 effect
is not reliable across subjects**, and F1 stays a single-observation finding
with one favourable and one unfavourable rerun.

## Re-run 2 — workbench-update-preservation — PASS

The subject added one line to the Shared Partial
(`> Checked: issue-1086`), then ran the update check.

Controller verification, computed from the check's own output rather than the
subject's report:

| Assertion | Verdict |
| --- | --- |
| Sentinel `reader-note: keep-this-sentinel` survives in the preview | pass |
| Hand-written prose survives in the preview body | pass |
| Prose appears **outside** (after) the managed region | pass |
| Changed managed output present and **inside** the managed region | pass |
| Note on disk byte-identical to the seed | pass |

`ok:true` with every check component `passed`, and `baseline.kind=real` with
`baseline.revision` equal to the disk note hash `58d43918…`. Only
`zotlit-partial.book-details.md` changed (`9db8c823…` → `ce394d90…`).
Contamination gate: PASS.

## W2 under the trimmed wording

| Skill state | Runs | Reached for a git oracle | Produced byte evidence |
| --- | --- | --- | --- |
| Before refinement | 10 | 10 | mixed; several fell back to bytes after noticing the vault was ignored |
| Refined, long wording | 1 (update-preservation) | 1, bytes primary | yes |
| Trimmed wording | 2 | **0** | yes, both |

Re-run 1 proved preservation from the revisions the check reports; re-run 2
hashed the note before and after and matched it to the check's own
`baseline.revision`. Both are exactly the two oracles the trimmed sentence
names, and neither run invoked git. The two transcripts do contain the string
`git status`, but only inside the harness-injected environment block, not in
any command either subject ran.

Two runs is a small sample. The honest statement is that removing the rationale
did not bring the git reflex back in either run.

## Verification after the trim

`pnpm lint` clean at the repo's pre-existing 27 warnings, which also verifies
types. `turbo run test --filter=@zotlit/scripts`: 149 passed, 4 skipped.
`pnpm format` clean. CLI Contract remains 7; the skill's pin remains 7.
