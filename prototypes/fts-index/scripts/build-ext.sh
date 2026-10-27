#!/usr/bin/env bash
# Build zotlit_cjk SQLite loadable extension variants.
# Usage: build-ext.sh [icu|jieba|both]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/crates/zotlit-fts-ext"
VARIANT="${1:-both}"
mkdir -p "$ROOT/dist"

build_one() {
  local name="$1" features="$2" target_dir="$3"
  echo "==> building $name (features=$features)"
  (
    cd "$EXT"
    if [[ "$features" == "none" ]]; then
      CARGO_TARGET_DIR="$target_dir" cargo build --release --no-default-features
    else
      CARGO_TARGET_DIR="$target_dir" cargo build --release --no-default-features --features "$features"
    fi
  )
  local so="$target_dir/release/libzotlit_cjk.so"
  # macOS / Windows names
  [[ -f "$so" ]] || so="$target_dir/release/libzotlit_cjk.dylib"
  [[ -f "$so" ]] || so="$target_dir/release/zotlit_cjk.dll"
  cp -a "$so" "$ROOT/dist/$name"
  # strip if available (Linux)
  if command -v strip >/dev/null && [[ "$so" == *.so ]]; then
    strip "$ROOT/dist/$name" 2>/dev/null || true
  fi
  ls -la "$ROOT/dist/$name"
}

case "$VARIANT" in
  icu)
    build_one zotlit_cjk_icu.so none /tmp/zotlit-ext-icu
    cp -a "$ROOT/dist/zotlit_cjk_icu.so" "$ROOT/dist/zotlit_cjk.so"
    ;;
  jieba)
    build_one zotlit_cjk_icu_jieba.so jieba /tmp/zotlit-ext-jieba
    cp -a "$ROOT/dist/zotlit_cjk_icu_jieba.so" "$ROOT/dist/zotlit_cjk.so"
    ;;
  both|*)
    build_one zotlit_cjk_icu.so none /tmp/zotlit-ext-icu
    build_one zotlit_cjk_icu_jieba.so jieba /tmp/zotlit-ext-jieba
    # Default ship ICU-only as zotlit_cjk.so
    cp -a "$ROOT/dist/zotlit_cjk_icu.so" "$ROOT/dist/zotlit_cjk.so"
    ;;
esac
echo "done. Prefer one variant per install (entry-symbol collision if both loaded in one process)."
