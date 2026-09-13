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

## Limitations

The final review's P1 coverage gap remains open: the broader fixed authoring
cases and sequential mutation trials in fresh Vault Cases are not established
by these four Luna trials. The supplemental recovery success does not close
that gap or supply the missing no-skill held-out comparison.

The live probes use a configured Fixture Case and scratch files. They do not
replace sequential mutation trials for every fixed prompt in a fresh Vault
Case. Those prompts remain listed in the parent issue and are marked
unverified when a fresh agent cannot safely reach them.

The [evidence index](evidence/README.md) records prompts, identity, preserved
artifacts, and reset limitations. These initial trials did not reset a fresh
Vault Case between runs. The benchmark includes exactly three trials and
uses null for unavailable measurements.
