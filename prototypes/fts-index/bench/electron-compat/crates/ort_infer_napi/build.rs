use std::env;
use std::path::PathBuf;

fn main() {
    napi_build::setup();

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let compat = manifest_dir.join("../glibc_compat");
    println!("cargo:rustc-link-search=native={}", compat.display());
    println!("cargo:rustc-link-lib=static=isoc23_shim");
    println!("cargo:rerun-if-changed={}", compat.join("libisoc23_shim.a").display());

    if env::var("ORT_STATIC_LIBSTDCXX").ok().as_deref() == Some("1") {
        for sym in [
            "_ZTVN10__cxxabiv120__si_class_type_infoE",
            "_ZTVN10__cxxabiv117__class_type_infoE",
            "__cxa_pure_virtual",
            "__cxa_throw",
            "__cxa_begin_catch",
            "__cxa_demangle",
        ] {
            println!("cargo:rustc-link-arg=-Wl,-u,{sym}");
        }
        let gcc = env::var("ORT_GCC_LIBDIR")
            .unwrap_or_else(|_| "/usr/lib/gcc/x86_64-linux-gnu/14".into());
        // zig ld.lld does not support --exclude-libs; still whole-archive libstdc++
        println!("cargo:rustc-link-arg=-Wl,--whole-archive");
        println!("cargo:rustc-link-arg={gcc}/libstdc++.a");
        println!("cargo:rustc-link-arg=-Wl,--no-whole-archive");
        println!("cargo:rustc-link-arg=-static-libgcc");
    }
}
