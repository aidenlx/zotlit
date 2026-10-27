# Built addons (not shipped)

Rebuild locally (Linux x64 example):

```bash
# ORT napi with glibc 2.28 + static libstdc++ + isoc23 shim
cargo zigbuild --release -p ort_infer_napi \
  --target x86_64-unknown-linux-gnu.2.28 \
  -Z build-std=std,panic_abort
# see REPORT / README for RUSTFLAGS (static libstdc++, hidden visibility)
# and linking crates/glibc_compat/isoc23_shim.c

# FTS CJK ICU .so similarly against glibc 2.28
```

Place resulting `.node` / `.so` here for the harness. Models: copy ONNX from the layout-compare / static-infer fetch steps into `../models/` (not committed).
