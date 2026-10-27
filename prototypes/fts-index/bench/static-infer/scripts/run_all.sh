#!/usr/bin/env bash
set -euo pipefail
ROOT=BENCH_ROOT/static-infer
source "$ROOT/.venv/bin/activate"
source "$HOME/.cargo/env"
python "$ROOT/scripts/gen_ref.py"
python "$ROOT/scripts/preprocess_onnx_for_tract.py"
(cd "$ROOT/tract-bench" && cargo run --release)
(cd "$ROOT/ort-bench" && cargo run --release)
echo "results in $ROOT/results/"
