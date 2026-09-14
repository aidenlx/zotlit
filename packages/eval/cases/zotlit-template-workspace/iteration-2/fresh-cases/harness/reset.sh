#!/bin/zsh
# Reset a case vault and gate on environment integrity. Usage: reset.sh <case-id>
set -e
CASE="$1"
ROOT="/Users/aidenlx/worktrees/zotlit-v2/codex-issue-1086"
cd "$ROOT"
mise exec -- pnpm fixture build --vault-case "$CASE" 2>&1 | rg --no-heading 'libraryID|Vault Case' || true
mise exec -- node packages/scripts/scripts/obsidian-vault.ts open --vault-case "$CASE" --purge 2>&1 | rg --no-heading 'vault|Vault' | tail -3 || true
VN="fixture-vault-codex-issue-1086-$CASE"
SEED=$(shasum -a 256 "$ROOT/tests/fixture-vault-codex-issue-1086-$CASE/templates/zotlit-profile.books.md" 2>/dev/null | cut -c1-16)
echo "--- environment gate ---"
echo "seed hash: ${SEED:-none}"
DBP=$(obsidian vault="$VN" zotlit:template-status 2>&1 | rg -o '"databasePath": *"[^"]+"' | head -1)
echo "database: $DBP"
echo "$DBP" | rg -q 'acceptance-fixture' || { echo "GATE FAIL: plugin is NOT on the Fixture database (Device Overrides missing)"; exit 1; }
LIBS=$(obsidian vault="$VN" zotlit:library-scope 2>&1 | rg -o '"libraryID":[0-9]+' | wc -l | tr -d ' ')
echo "libraries available: $LIBS (expect 4)"
[ "$LIBS" = "4" ] || { echo "GATE FAIL: incomplete database"; exit 1; }
for k in NW2CPDTC BKPUBLR4 BBBB2222; do
  OK=$(obsidian vault="$VN" zotlit:template-data key=$k root=note 2>&1 | rg -o '"ok": *[a-z]+' | head -1)
  echo "  $k -> $OK"
  echo "$OK" | rg -q 'true' || { echo "GATE FAIL: $k unresolvable"; exit 1; }
done
echo "GATE PASS"
