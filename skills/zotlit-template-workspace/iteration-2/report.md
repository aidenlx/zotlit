# Template Workbench skill and CLI evaluation — iteration 2

Date: 2026-09-13 (Asia/Singapore)

This iteration evaluates the candidate skill and CLI after #1093 on the same
configured Fixture Vault. The candidate is commit `0ba7d8b12` with CLI Contract
7, tested against Obsidian 1.14.1 and ZotLit 2.1.4. The previous read-only Luna
iteration is retained at `evidence/prior-iteration.md`.

After final review, the bundle from commit `c37419836` was rebuilt and
reloaded. An operator verified the retained-attempt recovery on that bundle.
The invalid lookup returned the new hint to omit `expect-source` and input
selectors while keeping the same vault prefix. The corrected lookup returned
the original source `8a19f09e`, current revisions, all checks passed, and
the full rendered output. [The final recovery record](evidence/final-recovery/transcript.md)
includes all three JSON responses.

This final probe verifies the recovery code fix. It is an operator check,
excluded from the three Luna benchmark trials. The initial Luna trial bundle
revision remains `0ba7d8b12`; those trials were not repeated in this probe.

A fresh Luna xhigh agent then checked the same final bundle.
[Its complete transcript](evidence/final-recovery-luna3/transcript.md) records
four commands: status discovery, initial check, invalid retained lookup, and
corrected lookup. The three recovery commands reproduce the omission hint
and return the same source `8a19f09e`, current revisions, all eight checks
passed, and full output for attempt `ab03cd65-3c8e-47c3-acf3-c30e06245bd3`.
This is one supplemental recovery trial, not a repeat of the spread or
held-out cases. The original benchmark has three trials; four Luna trials
are retained when this supplemental trial is included. Timing and token
counts for the supplemental trial are unavailable.

## Fixed environment

- Vault: `bd0ea1a22beb8f55`
- Vault path: `tests/fixture-vault-zotlit-v2`
- Zotero source: `8a19f09e`
- Database: `tmp/acceptance-fixture/zotero-data/zotero.sqlite`
- Candidate skill: `skills/zotlit-template/SKILL.md`
- Baseline: no skill, same vault and CLI
- Fresh model: `gpt-5.6-luna`, reasoning `xhigh`

## Independently checked outcomes

| Case | Expected evidence |
| --- | --- |
| JSON-e spread | Books Profile is selected; a scratch or direct edit is checked; the result contains `fixture-reviewed: true`; unrelated source and note text are preserved. |
| Citation and partial held-out case | Both `main` and `alt` execute; the selected Shared Partial caller is explicit; each result reports matching source revisions and output. |
| External freshness | A changed Shared Partial reaches `template-check` only with matching requested/disk/loaded revisions; a source is restored after the probe. |
| Scratch draft | A complete draft checks from its path with `input.origin=draft`; installed Profile, dependencies, notes, and settings remain byte-identical. |

## Live Obsidian evidence

The development build was rebuilt and reloaded in the configured vault. Help
listed `template-inspect`, `template-data`, and `template-check`; superseded
render/source/schema/frontmatter commands returned `COMMAND_RETIRED` with a
conversion hint. `template-status` returned Contract 7 and source `8a19f09e`.

An external edit changed the Shared Partial line from `Type` to `Kind`. A
Profile `template-check` returned the changed `Kind: journalArticle` output and
matching requested, disk, and loaded hashes for the Profile and dependencies.
The partial was restored and `template-inspect` then returned its original
source and matching hashes.

A scratch Profile at `tmp/live-final-draft.md` first produced a repairable
missing-annotation diagnostic. After adding the Annotation Section, the draft
check returned `ok=true`, `input.origin=draft`, revision
`099dd1e43a4f61eca29919d092d5ea7b259050a7fa0575e1d2584f566ac10f37`, and body
`# Draft live Alpha of the personal library` with the managed marker. The
aggregate SHA-256 of every file under the Development Vault was
`a867822753ec61ae8a967af18265aed30728d644646a8180801342c48c073e7b` both
before and after a repeated draft check. No installed Profile, Partial,
Literature Note, or settings file changed.

## Luna comparison

Fresh candidate and no-skill transcripts are committed under
[evidence](evidence/README.md). The run records command calls,
invalid arguments, diagnostics, output inspection, completion status, and
timing when the agents report it. The held-out candidate case covers Citation
Variants and a Shared Partial caller. The completed results and grades follow. The prior iteration established that the old skill
stopped at `template-check` because that command did not exist; this iteration
tests the same task against Contract 7 and the new inspect/edit/check loop.

The candidate run selected the Books Profile, copied it to a scratch draft,
added exactly one JSON-e spread, checked update output, verified the
new field and preserved note body, and recovered from one invalid attempt
lookup. It reported `freshness=current`, source `8a19f09e`, and no installed
vault writes. The no-skill run independently performed the same scratch edit
and checks on the same vault and also passed; it used more direct command
selection but did not have the skill's explicit completion vocabulary. This
case therefore shows equal task correctness, with the skill improving the
documented process and evidence rather than the binary outcome.

The held-out candidate run checked Citation Template `main` and `alt` with
distinct outputs and checked `partial:book-details` under `root=note` with
the Books Profile. It first surfaced `SOURCE_NOT_LOADED` for an omitted
Default context, recovered with explicit `profile=Books`, and reported current
source revisions and output for both variants and the partial. This is a
freshness/recovery pass on a task not used in the spread prompt.

### Grades

| Run | Result | Evidence |
| --- | --- | --- |
| with skill — JSON-e spread | 3/3 | Profile/source selection, `fixture-reviewed: true`, preservation/freshness/completion, and no writes are all evidenced in `with_skill/transcript.md`. |
| without skill — JSON-e spread | 3/3 | Same assertions pass in `without_skill/transcript.md`; the installed Profile equals its original scratch copy and update output is preview-only. |
| with skill — held-out citation/partial | 3/3 | Both variant outputs, partial caller/root, source revisions, recovery, and current freshness are recorded in `heldout_with_skill/transcript.md`. |

The spread case is non-discriminating for correctness because both agents
completed it. The candidate inspected the requested output and reported completion evidence. The held-out run demonstrates that the
same skill reaches the citation/partial branches and recovers from a source
freshness failure. Tokens and full trial durations were unavailable. The baseline transcript
records ten command durations; candidate timings are approximate and the
held-out transcript has no timings. The complete prior and final
transcripts are the review artifacts for qualitative grading.

## Fresh Vault Case matrix

The reset-isolated matrix the P1 asked for is complete. All nine Workbench
Vault Cases ran against a real Obsidian Development Vault, one fresh-context
subject per run, with the seed rebuilt and the Development Vault purged before
every run and every repeat. Twenty-three subject runs were dispatched: 20
graded, and 3 discarded and re-run after harness defects. Every grade reads
disk hashes and controller reproductions, never a subject's own report.

This matrix has its own environment identity: Contract 7, plugin 2.1.4,
Obsidian 1.14.1, Zotero source `1f2064de` on the Fixture database, subject
model `claude-sonnet`. The `8a19f09e` / `bd0ea1a22beb8f55` values above belong
to the three historical trials and are comparison metadata only.

The complete per-case record — every assertion, verdict, and piece of
evidence, the findings, the harness defects, and the regression set — is
[fresh-cases/results.md](fresh-cases/results.md). The case definitions are
[fresh-cases/README.md](fresh-cases/README.md), the environment and subject
configuration is [fresh-cases/run-config.md](fresh-cases/run-config.md), and
the reset, snapshot, and contamination-gate scripts are under
[fresh-cases/harness/](fresh-cases/harness/).

### What the matrix measured

| Measure | Result |
| --- | --- |
| Cases covered | 9 of 9, all passing their graded assertions |
| Skill advantage | none measurable on eight of nine cases |
| Convergence | candidate and no-skill baseline reached byte-identical results in cases 1-5, 7 and 8 |
| Baseline stronger | twice — case 1 on Item choice, case 5 on before/after evidence |
| Failure-sensitive repeats | yaml-repair 3/3 identical, external-edit 3/3 converged, default-no-note 3/3 identical, error-recovery 3/3 recovered |
| Held-out variation | passed on the held-out Item `BKPUBLR4` |

Unguided subjects reliably discovered `template-guide` from `obsidian help`
without help. This is the [CLI + skill pair policy](../../../policies/cli-skill-pair.md)
working as intended — tooling facts live in the CLI and agents find them — and
it is a finding about where the value sits, not a failure of the evaluation.

### Refinements measured back

Two changes answered repeated, measured failures rather than single
observations. The CLI Contract version is unchanged at 7, so the skill's
contract pin stays 7.

- **CLI (F2)** — the profile-check `INVALID_SELECTOR` rejection carried an
  accurate but non-corrective message. Two independent subjects, on two
  different command shapes, lost a call to it. It now carries a `recovery`
  naming the selectors that work.
- **Skill (F1, W2)** — step 4 now asks for an Item the source's own `match`
  rule selects or an existing Literature Note; step 5 now requires byte
  evidence for preservation, after 10 of 10 runs reached for a repository
  status that reads clean unconditionally in a git-ignored vault.

Three affected cases were rerun with fresh subjects against the refined
bundle. None changed its answer, and the verification improved: the spread
rerun chose a matching Item, named the rule, and rejected the vacuous git
oracle by name before producing sha256 evidence.

### Post-review re-runs

A later standards review found the step 5 wording carried its rationale inside
the spec body, against the Affirmative specs rule in `AGENTS.md`. The rationale
moved here and the skill kept only the actionable requirement, leaving it at
3197 bytes (sha256 `6bc29930…`). That rationale is: bytes are the evidence
because a vault often sits outside version control, where a repository status
reads clean whatever happened.

Because that edit changed the bytes the regression measured, the two affected
cases were run again from a fresh reset against the trimmed skill. Both passed
every graded assertion, and neither subject invoked git: `workbench-spread`
proved preservation from the revisions the check reports, and
`workbench-update-preservation` hashed the note before and after and matched it
to the check's own `baseline.revision`. Across the two runs the git reflex went
from 10 of 10 before refinement to 0 of 2.

One result is recorded against the refinement rather than for it. The spread
re-run checked a `journalArticle` while the Books Profile selects books, the
failure step 4 was reworded to prevent. It satisfied the wording through the
second clause — it ran its update check against an existing Literature Note —
but it did not choose a matching Item. The earlier rerun did and named the
rule. **The step 4 effect is therefore not reliable across subjects**, and F1
stays a single-observation finding with one favourable and one unfavourable
rerun. The full record is in
[fresh-cases/results.md](fresh-cases/results.md#post-review-re-runs-the-trimmed-skill).

## Limitations

The final review's P1 coverage gap is closed by the fresh Vault Case matrix
above. The four Luna trials below did not establish it; the nine reset-isolated
cases in [fresh-cases/results.md](fresh-cases/results.md) do, and they supply
the no-skill comparison the P1 asked for on every case.

The live probes in this section use a configured Fixture Case and scratch
files. They remain operator probes, and the matrix — not these probes — is the
evidence for sequential mutation under reset isolation.

Items the matrix recorded as open, none of which blocks the authoring loop:

- **W1, case design** — `workbench-external-edit` phase one captures only an
  inspect, so a subject can prove the new revision loaded but cannot say which
  visible text changed. One run guessed wrong. The manifest now asks phase one
  to capture a render as well.
- **W2, partially answered** — the skill wording moved the preservation oracle
  toward bytes without eliminating the git reflex; one rerun still touched git
  once, with bytes primary.
- **F1, single observation** — unlike F2 and W2, the non-matching-Item finding
  rests on one graded run plus its baseline contrast.

The [evidence index](evidence/README.md) records prompts, identity, preserved
artifacts, and reset limitations. These initial trials did not reset a fresh
Vault Case between runs. The benchmark includes exactly three trials and
uses null for unavailable measurements.
