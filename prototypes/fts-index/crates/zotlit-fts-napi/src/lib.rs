#![allow(clippy::missing_safety_doc)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::ffi::CString;
use std::os::raw::{c_char, c_int, c_void};
use std::sync::Arc;
use zotlit_cjk_core::{global_engine, CjkEngine, FTS5_TOKEN_COLOCATED, FTS5_TOKENIZE_QUERY};

type TokenCb = unsafe extern "C" fn(
    *mut c_void,
    c_int,
    *const c_char,
    c_int,
    c_int,
    c_int,
) -> c_int;

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
    x_find_tokenizer: *mut c_void,
    x_create_function: *mut c_void,
}

#[repr(C)]
struct Fts5Tokenizer {
    x_create: Option<
        unsafe extern "C" fn(*mut c_void, *mut *const c_char, c_int, *mut *mut Fts5TokenizerObj) -> c_int,
    >,
    x_delete: Option<unsafe extern "C" fn(*mut Fts5TokenizerObj)>,
    x_tokenize: Option<
        unsafe extern "C" fn(
            *mut Fts5TokenizerObj,
            *mut c_void,
            c_int,
            *const c_char,
            c_int,
            TokenCb,
        ) -> c_int,
    >,
}

#[repr(C)]
struct Fts5TokenizerObj {
    _private: [u8; 0],
}

struct TokInstance {
    engine: Arc<CjkEngine>,
    oov_bigram: bool,
}

unsafe extern "C" fn x_create(
    user_data: *mut c_void,
    _argv: *mut *const c_char,
    _argc: c_int,
    out: *mut *mut Fts5TokenizerObj,
) -> c_int {
    if user_data.is_null() || out.is_null() {
        return 21; // SQLITE_MISUSE
    }
    let engine = Arc::clone(&*(user_data as *const Arc<CjkEngine>));
    let inst = Box::new(TokInstance {
        engine,
        oov_bigram: true,
    });
    *out = Box::into_raw(inst) as *mut Fts5TokenizerObj;
    0
}

unsafe extern "C" fn x_delete(p: *mut Fts5TokenizerObj) {
    if p.is_null() {
        return;
    }
    drop(Box::from_raw(p as *mut TokInstance));
}

unsafe extern "C" fn x_tokenize(
    p: *mut Fts5TokenizerObj,
    ctx: *mut c_void,
    flags: c_int,
    text: *const c_char,
    n_text: c_int,
    cb: TokenCb,
) -> c_int {
    if p.is_null() || text.is_null() || n_text < 0 {
        return 21;
    }
    let inst = &*(p as *const TokInstance);
    let bytes = std::slice::from_raw_parts(text as *const u8, n_text as usize);
    let Ok(s) = std::str::from_utf8(bytes) else {
        return 1;
    };
    let is_query = (flags & FTS5_TOKENIZE_QUERY) != 0;
    let tokens = inst.engine.tokenize(s, is_query, inst.oov_bigram);
    for t in tokens {
        let b = t.text.as_bytes();
        let rc = cb(
            ctx,
            t.flags,
            b.as_ptr() as *const c_char,
            b.len() as c_int,
            t.start,
            t.end,
        );
        if rc != 0 {
            return rc;
        }
    }
    let _ = FTS5_TOKEN_COLOCATED;
    0
}

fn register_tokenizer(conn: &Connection, engine: Arc<CjkEngine>) -> Result<()> {
    unsafe {
        let db = conn.handle();
        let mut api: *mut Fts5Api = std::ptr::null_mut();
        let mut stmt: *mut rusqlite::ffi::sqlite3_stmt = std::ptr::null_mut();
        let sql = CString::new("SELECT fts5(?1)").unwrap();
        let rc = rusqlite::ffi::sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, std::ptr::null_mut());
        if rc != 0 {
            return Err(Error::from_reason(format!("prepare fts5: {rc}")));
        }
        let type_name = CString::new("fts5_api_ptr").unwrap();
        let brc = rusqlite::ffi::sqlite3_bind_pointer(
            stmt,
            1,
            &mut api as *mut _ as *mut c_void,
            type_name.as_ptr(),
            None,
        );
        let src = rusqlite::ffi::sqlite3_step(stmt);
        let frc = rusqlite::ffi::sqlite3_finalize(stmt);
        if api.is_null() {
            // probe compile options
            let mut has = false;
            if let Ok(mut s) = conn.prepare("PRAGMA compile_options") {
                let opts: Vec<String> = s
                    .query_map([], |r| r.get(0))
                    .ok()
                    .map(|it| it.filter_map(|x| x.ok()).collect())
                    .unwrap_or_default();
                has = opts.iter().any(|o| o.contains("FTS5"));
            }
            return Err(Error::from_reason(format!(
                "fts5_api null (bind={brc} step={src} fin={frc} fts5_compiled={has})"
            )));
        }
        let name = CString::new("zotlit_cjk").unwrap();
        let engine_box = Box::new(engine);
        let user = Box::into_raw(engine_box) as *mut c_void;
        let mut tok = Fts5Tokenizer {
            x_create: Some(x_create),
            x_delete: Some(x_delete),
            x_tokenize: Some(x_tokenize),
        };
        let create = (*api)
            .x_create_tokenizer
            .ok_or_else(|| Error::from_reason("xCreateTokenizer missing"))?;
        let rc = create(api, name.as_ptr(), user, &mut tok, Some(drop_engine));
        if rc != 0 {
            drop(Box::from_raw(user as *mut Arc<CjkEngine>));
            return Err(Error::from_reason(format!("xCreateTokenizer rc={rc}")));
        }
    }
    Ok(())
}

unsafe extern "C" fn drop_engine(p: *mut c_void) {
    if !p.is_null() {
        drop(Box::from_raw(p as *mut Arc<CjkEngine>));
    }
}

#[napi]
pub struct FtsDb {
    inner: Mutex<Connection>,
    engine: Arc<CjkEngine>,
}

#[napi]
impl FtsDb {
    #[napi(factory)]
    pub fn open(path: String) -> Result<Self> {
        let engine = Arc::clone(global_engine());
        let conn = if path == ":memory:" {
            Connection::open_in_memory()
        } else {
            Connection::open(&path)
        }
        .map_err(|e| Error::from_reason(e.to_string()))?;
        // Confirm FTS5
        let _: String = conn
            .query_row("SELECT sqlite_version()", [], |r| r.get(0))
            .map_err(|e| Error::from_reason(e.to_string()))?;
        register_tokenizer(&conn, Arc::clone(&engine))?;
        Ok(Self {
            inner: Mutex::new(conn),
            engine,
        })
    }

    #[napi]
    pub fn exec(&self, sql: String) -> Result<()> {
        self.inner
            .lock()
            .execute_batch(&sql)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn run(&self, sql: String, params: Option<Vec<String>>) -> Result<u32> {
        let conn = self.inner.lock();
        let n = match params {
            Some(p) => {
                let refs: Vec<&str> = p.iter().map(|s| s.as_str()).collect();
                conn.execute(&sql, rusqlite::params_from_iter(refs))
            }
            None => conn.execute(&sql, []),
        }
        .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(n as u32)
    }

    #[napi]
    pub fn all(&self, sql: String, params: Option<Vec<String>>) -> Result<Vec<Vec<String>>> {
        let conn = self.inner.lock();
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let col_count = stmt.column_count();
        let rows = match params {
            Some(p) => {
                let refs: Vec<&str> = p.iter().map(|s| s.as_str()).collect();
                let mapped = stmt
                    .query_map(rusqlite::params_from_iter(refs), |row| {
                        let mut v = Vec::with_capacity(col_count);
                        for i in 0..col_count {
                            let s: rusqlite::types::Value = row.get(i)?;
                            v.push(match s {
                                rusqlite::types::Value::Null => String::new(),
                                rusqlite::types::Value::Integer(i) => i.to_string(),
                                rusqlite::types::Value::Real(f) => f.to_string(),
                                rusqlite::types::Value::Text(t) => t,
                                rusqlite::types::Value::Blob(_) => "<blob>".into(),
                            });
                        }
                        Ok(v)
                    })
                    .map_err(|e| Error::from_reason(e.to_string()))?;
                mapped
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| Error::from_reason(e.to_string()))?
            }
            None => {
                let mapped = stmt
                    .query_map([], |row| {
                        let mut v = Vec::with_capacity(col_count);
                        for i in 0..col_count {
                            let s: rusqlite::types::Value = row.get(i)?;
                            v.push(match s {
                                rusqlite::types::Value::Null => String::new(),
                                rusqlite::types::Value::Integer(i) => i.to_string(),
                                rusqlite::types::Value::Real(f) => f.to_string(),
                                rusqlite::types::Value::Text(t) => t,
                                rusqlite::types::Value::Blob(_) => "<blob>".into(),
                            });
                        }
                        Ok(v)
                    })
                    .map_err(|e| Error::from_reason(e.to_string()))?;
                mapped
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| Error::from_reason(e.to_string()))?
            }
        };
        Ok(rows)
    }

    #[napi]
    pub fn add_word(&self, word: String, freq: Option<u32>) -> Result<()> {
        self.engine
            .add_word(&word, freq.map(|f| f as usize));
        Ok(())
    }

    #[napi]
    pub fn sqlite_version(&self) -> Result<String> {
        let conn = self.inner.lock();
        conn.query_row("SELECT sqlite_version()", [], |r| r.get(0))
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn compile_options_has_fts5(&self) -> Result<bool> {
        let conn = self.inner.lock();
        let mut stmt = conn
            .prepare("PRAGMA compile_options")
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let opts = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| Error::from_reason(e.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(opts.iter().any(|o| o.contains("FTS5")))
    }
}

#[napi]
pub fn tokenize_debug(text: String, is_query: bool) -> Result<Vec<String>> {
    let e = global_engine();
    let toks = e.tokenize(&text, is_query, true);
    Ok(toks
        .into_iter()
        .map(|t| format!("{}|{}|{}-{}", t.text, t.flags, t.start, t.end))
        .collect())
}
