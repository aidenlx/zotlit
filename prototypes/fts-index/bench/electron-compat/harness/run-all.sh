#!/bin/bash
set -euo pipefail
ROOT=BENCH_ROOT/electron-compat
RES=$ROOT/results
mkdir -p "$RES"
run_one() {
  local name=$1
  local bin=$2
  local out=$RES/${name}.json
  echo "=== Running $name ==="
  COMPAT_OUT="$out" \
  ELECTRON_ENABLE_LOGGING=1 \
  xvfb-run -a -s "-screen 0 1280x720x24" \
    "$bin" "$ROOT/harness/main.js" \
    --no-sandbox --disable-gpu --disable-dev-shm-usage \
    > "$RES/${name}.stdout.log" 2>"$RES/${name}.stderr.log" || true
  if [[ -f "$out" ]]; then
    echo "OK $out ($(wc -c < "$out") bytes)"
  else
    echo "MISSING $out"
    tail -30 "$RES/${name}.stderr.log" || true
  fi
}

run_one e39 "$ROOT/electrons/e39/node_modules/electron/dist/electron"
run_one e43 "$ROOT/electrons/e43/node_modules/electron/dist/electron"
run_one e45 "$ROOT/electrons/e45/node_modules/electron/dist/electron"
echo ALL_DONE
