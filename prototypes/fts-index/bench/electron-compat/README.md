# Electron / distribution compatibility

Harness that loads the Rust static-`ort` napi addon and the `zotlit_cjk`
ICU tokenizer across **Electron 39.6.0 / 43.8.3 / 45.0.0** in
main / renderer / `utilityProcess` / `child_process`.

## Floors (tentative)

- **Scope:** Electron **43+** only for shipping (Obsidian **1.13.4+** =
  Electron 43.1.1; current 1.14.5 = 43.8.3). Electron 39 may still appear
  on older installers — harness covers it for confidence.
- **OS:** macOS 12+, Windows 10+, Linux glibc **2.28** (Debian 10) via
  `cargo zigbuild --target x86_64-unknown-linux-gnu.2.28`, static
  libstdc++, and the [`__isoc23_*` shim](./crates/glibc_compat/isoc23_shim.c)
  (pyke’s prebuilt `libonnxruntime.a` references GLIBC_2.38).
- **Arch built so far:** Linux x64 only. macOS / Windows / arm64 not yet.
- Open question: glibc floor 2.27 (Ubuntu 18.04) vs 2.28.

Node-API ABI is stable → **one binary per platform/arch**, no
per-Electron rebuild (unlike `better-sqlite3`).

## Other Electron notes

- `node:sqlite` needs `allowExtension` before `loadExtension`.
- `napi_create_external_arraybuffer` is rejected in Electron 21+ → use
  JS-allocated buffers (see `zerocopy-probe/`).
- ORT allows **one `Environment` per process** (including `worker_threads`)
  → isolate inference in `child_process` / `utilityProcess`.

## Results

All tested matrix cells pass. JSON under [`results/`](./results/)
(`e39.json`, `e43.json`, `e45.json`, worker variants, `support-floor.json`).
Chinese summary: `SUMMARY.zh.md` / `REPORT.zh.md`.

## What is not in this tree

- Built `.node` / `.so` addons, `node_modules/`, all `target*` dirs
- ONNX model weights under `models/`

See [`addons/README.md`](./addons/README.md) for rebuild commands.

## Reproduce

```bash
npm i
# build ort_infer_napi against glibc 2.28 (see addons/README.md + .cargo/)
# place .node into addons/; place models alongside
./harness/run-all.sh
# or: electron electrons/e43/node_modules/electron/... harness/main.js
```
