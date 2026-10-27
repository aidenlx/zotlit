# Static inference backend comparison

Side-by-side CPU latency / correctness probes for the layout models:

| Backend | Notes |
|---------|--------|
| **ort** (static onnxruntime via Rust) | Chosen path; MAD 0 vs Python ref |
| **tract** | ~25 ms block-seg; cannot run DocLayout |
| **candle** | Explored; see report |
| **Paddle / Paddle-Lite** | Reference + footprint; DocLayout-M/L ONNX export blocked |

Chinese write-up: `REPORT.zh.md`. Numbers:
[`results/ort.json`](./results/ort.json),
[`results/tract.json`](./results/tract.json),
[`results/cpu_threads_latency.json`](./results/cpu_threads_latency.json),
[`results/paddle_infer_doclayout.json`](./results/paddle_infer_doclayout.json).

Small NumPy reference tensors under `ref/` (not model weights).

## What is not in this tree

- ONNX / Paddle model weights (`models/`)
- Python venvs (`.venv`, `paddle26-venv`)
- `~/.paddlex` caches, built binaries, `target/`

## Reproduce

```bash
# place block-seg + PP-DocLayout-S ONNX under models/
./scripts/run_all.sh
python3 scripts/bench_cpu_threads.py
python3 scripts/gen_ref.py   # regenerate ref/*.npy against the ORT baseline
```

The production napi addon used by layout-compare / electron-compat lives
under `../layout-compare/native-ort` and `../electron-compat/crates/`.
