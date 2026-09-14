#!/bin/zsh
# After a purge, Obsidian has not observed the folder swap, so a deleted
# dependency still reports SOURCE_NOT_LOADED with a stale loaded revision.
# Recreate the file and delete it again so the running app observes a real
# deletion event, leaving the intended missing-partial precondition.
ROOT="/Users/aidenlx/worktrees/zotlit-v2/codex-issue-1086"
V="$ROOT/tests/fixture-vault-codex-issue-1086-workbench-error-recovery"
VN="fixture-vault-codex-issue-1086-workbench-error-recovery"
P="$V/templates/zotlit-partial.book-details.md"
printf -- '---\nlanguage: liquid\n---\n> [!info] Book details\n> Type: {{ zt.itemType }}\n> Citation key: {{ zt.citationKey | default: zt.key }}\n' > "$P"
sleep 4
rm -f "$P"
sleep 5
CODE=$(obsidian vault="$VN" zotlit:template-check profile=Books key=BBBB2222 2>&1 | rg -o '"code": *"[A-Za-z_-]+"' | head -1)
echo "precondition diagnostic: $CODE"
echo "$CODE" | rg -q 'missing-partial' && echo "PRECONDITION OK" || echo "PRECONDITION FAIL"
