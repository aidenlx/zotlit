fn main() {
    // libsqlite3-sys `bundled` enables SQLITE_ENABLE_FTS5 by default.
    napi_build::setup();
}
