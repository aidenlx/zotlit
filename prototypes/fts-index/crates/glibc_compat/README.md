# glibc `__isoc23_*` compatibility shim

pyke’s prebuilt `libonnxruntime.a` (as pulled by the `ort` crate) references
`__isoc23_sscanf` / `__isoc23_strtol` / related symbols that appear only in
**GLIBC_2.38+**. Obsidian / Electron Linux floors are closer to glibc 2.28
(Debian 10).

This tiny C shim provides those symbols by forwarding to the older ISO C
entry points, so a binary built with `cargo zigbuild --target
x86_64-unknown-linux-gnu.2.28` still loads on glibc 2.28 hosts.

## Build

```bash
# produce libisoc23_shim.a next to this README
cc -c -fPIC -O2 isoc23_shim.c -o isoc23_shim.o
ar rcs libisoc23_shim.a isoc23_shim.o
```

Link from the napi addon `build.rs` (see `bench/electron-compat/crates/ort_infer_napi/build.rs`):

```text
cargo:rustc-link-search=native=<this-dir>
cargo:rustc-link-lib=static=isoc23_shim
```

Recommended release flags (with zigbuild):

```bash
export RUSTFLAGS="-C link-arg=-static-libstdc++ -C link-arg=-Wl,--exclude-libs,ALL -C visibility=hidden"
cargo zigbuild --release -p ort_infer_napi --target x86_64-unknown-linux-gnu.2.28
```

Longer term: build ONNX Runtime from source in CI against the desired glibc
floor instead of relying on the shim.
