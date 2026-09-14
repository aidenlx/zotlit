# Workbench trial evidence

This Case retains the trial evidence transferred from [#1086](https://github.com/aidenlx/zotlit/issues/1086)
and [#1093](https://github.com/aidenlx/zotlit/issues/1093). [#1114](https://github.com/aidenlx/zotlit/issues/1114)
owns the evaluation platform, Fixture trial tools, evidence audit, and subsequent trials.

## Provenance

The 40 files under `iteration-2/` were restored byte for byte, with their original file modes,
from commit `1cd2753b1360e466e583fa2fde078d253badde9e`, where they lived under
`skills/zotlit-template-workspace/iteration-2/`. See the
[original tree](https://github.com/aidenlx/zotlit/tree/1cd2753b1360e466e583fa2fde078d253badde9e/skills/zotlit-template-workspace/iteration-2).

These records describe the source versions and environments recorded during those trials.
Their historical paths, commands, and conclusions remain as captured. A new trial records
its own versions and outcomes in a new Iteration.

## Evidence index

- [Iteration report](iteration-2/report.md): findings, refinements, and recorded limits.
- [Evidence index](iteration-2/evidence/README.md): retained transcripts and check outputs.
- [Fresh-case results](iteration-2/fresh-cases/results.md): the reported nine-case matrix,
  discarded runs, comparisons, and regression outcomes.
- [Run configuration](iteration-2/fresh-cases/run-config.md): environment and reset procedure.
- [Historical harness](iteration-2/fresh-cases/harness/README.md): scripts with paths tied to
  the original machine. The current reset operation is documented in `docs/fixture.md`.

## Current verification

Restoration establishes that the committed historical files are retained. The evidence audit
in #1114 checks their coverage against the transferred requirements and records any missing
raw artifacts. The known trigger-parser defect and package standards findings also remain
with #1114. Current-platform completion requires the checks and fresh evidence specified there.
