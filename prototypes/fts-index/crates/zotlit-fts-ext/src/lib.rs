//! SQLite loadable extension: FTS5 tokenizer `zotlit_cjk`.
//!
//! Args (space-separated barewords after the name). FTS5 rejects `=` in tokenize
//! strings, so use: `tokenize='zotlit_cjk'` | `… jieba`/`zh_jieba` | `… icu`/`zh_icu`
//! | `… ja` | `… ko`. Conceptual choice remains zh ∈ {jieba, icu}.
//! Changing args requires DROP + recreate + reindex. Store the chosen label in a
//! meta table (e.g. `zotlit_fts_meta`) alongside `zotlit_cjk_caps()` build id.
#![allow(non_snake_case, clippy::missing_safety_doc)]

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::sync::Arc;
use zotlit_cjk_core::{
    global_engine, CjkEngine, TokOpts, FTS5_TOKENIZE_QUERY, HAS_JIEBA,
};

use libsqlite3_sys::{
    rusqlite_extension_init2, sqlite3, sqlite3_api_routines, sqlite3_bind_pointer,
    sqlite3_finalize, sqlite3_prepare_v2, sqlite3_step, sqlite3_stmt, SQLITE_ERROR, SQLITE_MISUSE,
    SQLITE_OK,
};

type TokenCb = unsafe extern "C" fn(*mut c_void, c_int, *const c_char, c_int, c_int, c_int) -> c_int;

#[repr(C)]
struct Fts5Api {
    i_version: c_int,
    x_create_tokenizer: Option<
        unsafe extern "C" fn(
            *mut Fts5Api,
            *const c_char,
            *mut c_void,
            *mut Fts5Tokenizer,
            Option<unsafe extern "C" fn(*mut c_void)>,
        ) -> c_int,
    >,
    _x_find: *mut c_void,
    _x_func: *mut c_void,
}

#[repr(C)]
struct Fts5Tokenizer {
    x_create: Option<
        unsafe extern "C" fn(*mut c_void, *mut *const c_char, c_int, *mut *mut Fts5Tok) -> c_int,
    >,
    x_delete: Option<unsafe extern "C" fn(*mut Fts5Tok)>,
    x_tokenize: Option<
        unsafe extern "C" fn(*mut Fts5Tok, *mut c_void, c_int, *const c_char, c_int, TokenCb) -> c_int,
    >,
}

#[repr(C)]
struct Fts5Tok {
    _private: [u8; 0],
}

struct TokInstance {
    engine: Arc<CjkEngine>,
    opts: TokOpts,
}

#[used]
static KEEP_ENGINE: fn() -> usize =
    || global_engine().tokenize("版本管理テスト저장 pre-commit ภาษา", false, true).len();

thread_local! {
    static LAST_CREATE_ERR: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

unsafe extern "C" fn x_create(
    user: *mut c_void,
    az_arg: *mut *const c_char,
    n_arg: c_int,
    out: *mut *mut Fts5Tok,
) -> c_int {
    if user.is_null() || out.is_null() {
        return SQLITE_MISUSE;
    }
    let mut args: Vec<&str> = Vec::new();
    let mut owned: Vec<String> = Vec::new();
    if !az_arg.is_null() && n_arg > 0 {
        for i in 0..n_arg as isize {
            let p = *az_arg.offset(i);
            if p.is_null() {
                continue;
            }
            if let Ok(s) = CStr::from_ptr(p).to_str() {
                owned.push(s.to_string());
            }
        }
    }
    for s in &owned {
        args.push(s.as_str());
    }
    let opts = match TokOpts::parse_args(&args) {
        Ok(o) => o,
        Err(msg) => {
            eprintln!("zotlit_cjk tokenizer: {msg}");
            LAST_CREATE_ERR.with(|c| *c.borrow_mut() = Some(msg));
            return SQLITE_ERROR;
        }
    };
    LAST_CREATE_ERR.with(|c| *c.borrow_mut() = None);
    let engine = Arc::clone(&*(user as *const Arc<CjkEngine>));
    *out = Box::into_raw(Box::new(TokInstance { engine, opts })) as *mut Fts5Tok;
    SQLITE_OK
}

unsafe extern "C" fn x_delete(p: *mut Fts5Tok) {
    if !p.is_null() {
        drop(Box::from_raw(p as *mut TokInstance));
    }
}

unsafe extern "C" fn x_tokenize(
    p: *mut Fts5Tok,
    ctx: *mut c_void,
    flags: c_int,
    text: *const c_char,
    n: c_int,
    cb: TokenCb,
) -> c_int {
    if p.is_null() || text.is_null() || n < 0 {
        return SQLITE_MISUSE;
    }
    let inst = &*(p as *const TokInstance);
    let bytes = std::slice::from_raw_parts(text as *const u8, n as usize);
    let Ok(s) = std::str::from_utf8(bytes) else {
        return SQLITE_ERROR;
    };
    let is_query = (flags & FTS5_TOKENIZE_QUERY) != 0;
    for t in inst
        .engine
        .tokenize_opts(s, is_query, true, inst.opts)
    {
        let b = t.text.as_bytes();
        let rc = cb(
            ctx,
            t.flags,
            b.as_ptr() as *const c_char,
            b.len() as c_int,
            t.start,
            t.end,
        );
        if rc != SQLITE_OK {
            return rc;
        }
    }
    SQLITE_OK
}

unsafe extern "C" fn drop_user(p: *mut c_void) {
    if !p.is_null() {
        drop(Box::from_raw(p as *mut Arc<CjkEngine>));
    }
}

unsafe fn register(db: *mut sqlite3) -> c_int {
    let mut api: *mut Fts5Api = std::ptr::null_mut();
    let mut stmt: *mut sqlite3_stmt = std::ptr::null_mut();
    let sql = CString::new("SELECT fts5(?1)").unwrap();
    let type_name = CString::new("fts5_api_ptr").unwrap();
    let rc = sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, std::ptr::null_mut());
    if rc != SQLITE_OK {
        return rc;
    }
    sqlite3_bind_pointer(
        stmt,
        1,
        &mut api as *mut _ as *mut c_void,
        type_name.as_ptr(),
        None,
    );
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if api.is_null() {
        return SQLITE_ERROR;
    }
    let name = CString::new("zotlit_cjk").unwrap();
    let user = Box::into_raw(Box::new(Arc::clone(global_engine()))) as *mut c_void;
    let mut tok = Fts5Tokenizer {
        x_create: Some(x_create),
        x_delete: Some(x_delete),
        x_tokenize: Some(x_tokenize),
    };
    let Some(create) = (*api).x_create_tokenizer else {
        drop(Box::from_raw(user as *mut Arc<CjkEngine>));
        return SQLITE_ERROR;
    };
    let rc = create(api, name.as_ptr(), user, &mut tok, Some(drop_user));
    if rc != SQLITE_OK {
        drop(Box::from_raw(user as *mut Arc<CjkEngine>));
        return rc;
    }

    // Scalar: SELECT zotlit_cjk_caps(); → "icu" | "icu+jieba"
    // Registered via raw SQL create_function through a tiny helper prepared stmt
    // is awkward without full API; expose via a side-channel pragma-like table:
    // we stash build id by creating a temp view isn't possible here either.
    // Instead: keep a global and document; Node can also read from file name.
    let _ = HAS_JIEBA;
    let _ = db;
    SQLITE_OK
}

/// C ABI helper so hosts can probe the build without CREATE.
#[no_mangle]
pub extern "C" fn zotlit_cjk_build_id() -> *const c_char {
    static ICU: &[u8] = b"icu\0";
    static BOTH: &[u8] = b"icu+jieba\0";
    if HAS_JIEBA {
        BOTH.as_ptr() as *const c_char
    } else {
        ICU.as_ptr() as *const c_char
    }
}

#[no_mangle]
pub unsafe extern "C" fn sqlite3_zotlitcjk_init(
    db: *mut sqlite3,
    err: *mut *mut c_char,
    api: *mut sqlite3_api_routines,
) -> c_int {
    if rusqlite_extension_init2(api).is_err() {
        return SQLITE_ERROR;
    }
    let rc = register(db);
    if rc != SQLITE_OK && !err.is_null() {
        // best-effort message
        let msg = CString::new("zotlit_cjk: failed to register FTS5 tokenizer").unwrap();
        // We cannot reliably free via host allocator without api->xFree; leave null.
        let _ = msg;
        let _ = err;
    }
    rc
}

#[no_mangle]
pub unsafe extern "C" fn sqlite3_extension_init(
    db: *mut sqlite3,
    err: *mut *mut c_char,
    api: *mut sqlite3_api_routines,
) -> c_int {
    sqlite3_zotlitcjk_init(db, err, api)
}
