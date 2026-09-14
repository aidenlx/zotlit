#!/bin/zsh
# Contamination gate: flags access to grader artifacts, prescribed solutions,
# and design history. Project AGENTS.md is injected into every subagent by the
# harness, is identical across both arms, and carries no solution or grading
# content, so it is not probed.
T=/private/tmp/claude-501/-Users-aidenlx-worktrees-zotlit-v2-codex-issue-1086/6f3e6e48-ace8-4875-8a82-93c5818a01f6/tasks/$1.output
FAIL=0
for pat in 'fresh-cases' 'zotlit-template-workspace' 'iteration-2' 'evals.json' 'case-snapshots' 'fixture/spec.ts'; do
  N=$(rg -c --fixed-strings "$pat" "$T" 2>/dev/null || echo 0)
  [ "$N" != "0" ] && { echo "CONTAMINATED: $pat ($N)"; FAIL=1; }
done
[ $FAIL = 0 ] && echo "GATE PASS"
