#!/bin/zsh
# Snapshot a case vault's graded surface. Usage: snapshot.sh <case-id> <phase> [run-tag]
set -u
CASE="$1"; PHASE="$2"; TAG="${3:-}"
ROOT="/Users/aidenlx/worktrees/zotlit-v2/codex-issue-1086"
V="$ROOT/tests/fixture-vault-codex-issue-1086-$CASE"
OUT="$ROOT/tmp/fresh-cases-runs/$CASE${TAG:+-$TAG}"
mkdir -p "$OUT"
F="$OUT/$PHASE.txt"
{
  echo "case=$CASE phase=$PHASE tag=$TAG"
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "vault_path=$V"
  echo "--- file hashes ---"
  for rel in templates/zotlit-profile.books.md templates/zotlit-partial.book-details.md templates/zotlit-citation.md scratch/workbench-draft.md; do
    if [ -f "$V/$rel" ]; then
      echo "$(shasum -a 256 "$V/$rel" | cut -d' ' -f1)  $rel"
    else
      echo "ABSENT  $rel"
    fi
  done
  echo "--- notes ---"
  if [ -d "$V/books" ]; then
    find "$V/books" -name '*.md' -exec shasum -a 256 {} \; | sed "s|$V/||"
  else
    echo "NO books/ FOLDER"
  fi
  echo "--- settings ---"
  if [ -f "$V/.obsidian/plugins/zotlit/data.json" ]; then
    shasum -a 256 "$V/.obsidian/plugins/zotlit/data.json" | cut -d' ' -f1
  else
    echo "ABSENT data.json"
  fi
  echo "--- archived copies ---"
  mkdir -p "$OUT/$PHASE-files"
  for rel in templates/zotlit-profile.books.md templates/zotlit-partial.book-details.md templates/zotlit-citation.md scratch/workbench-draft.md; do
    [ -f "$V/$rel" ] && cp "$V/$rel" "$OUT/$PHASE-files/$(basename $rel)"
  done
  [ -d "$V/books" ] && cp -R "$V/books" "$OUT/$PHASE-files/books" 2>/dev/null
  echo "archived to $OUT/$PHASE-files"
  echo "--- skill bytes ---"
  shasum -a 256 "$ROOT/skills/zotlit-template/SKILL.md"
  echo "--- identity ---"
  obsidian vault="fixture-vault-codex-issue-1086-$CASE" zotlit:template-status 2>&1 | head -20
} > "$F" 2>&1
echo "wrote $F"
