#![deny(clippy::all)]
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::ptr;

#[napi(object)]
pub struct SumOut {
    pub sum: f64,
    pub ms: f64,
    pub len: u32,
}

#[napi(object)]
pub struct ExternalOut {
    pub ok: bool,
    pub status: i32,
    pub len: u32,
    pub error: Option<String>,
    pub checksum: Option<u32>,
}

/// Try napi_create_external_arraybuffer (fails on Electron >=21 V8 memory cage).
#[napi]
pub fn try_external_arraybuffer(env: Env, n: u32) -> Result<ExternalOut> {
    let len = n as usize;
    let mut vec = vec![0u8; len];
    for (i, b) in vec.iter_mut().enumerate() {
        *b = (i % 251) as u8;
    }
    let data_ptr = vec.as_mut_ptr();
    let leak = Box::into_raw(Box::new(vec));

    let mut ab: napi::sys::napi_value = ptr::null_mut();
    let status = unsafe {
        napi::sys::napi_create_external_arraybuffer(
            env.raw(),
            data_ptr as *mut _,
            len,
            Some(finalize_vec),
            leak as *mut _,
            &mut ab,
        )
    };

    if status != 0 {
        unsafe { drop(Box::from_raw(leak)) };
        return Ok(ExternalOut {
            ok: false,
            status: status as i32,
            len: n,
            error: Some(format!(
                "napi_create_external_arraybuffer status={status} (napi_no_external_buffers_allowed is typically 25)"
            )),
            checksum: None,
        });
    }

    // Read back first bytes via raw get_arraybuffer_info to checksum
    let mut ptr_out: *mut std::ffi::c_void = ptr::null_mut();
    let mut len_out: usize = 0;
    let st = unsafe {
        napi::sys::napi_get_arraybuffer_info(env.raw(), ab, &mut ptr_out, &mut len_out)
    };
    let checksum = if st == 0 && !ptr_out.is_null() {
        let slice = unsafe { std::slice::from_raw_parts(ptr_out as *const u8, len_out.min(64)) };
        Some(slice.iter().map(|&b| b as u32).sum())
    } else {
        None
    };

    Ok(ExternalOut {
        ok: true,
        status: 0,
        len: n,
        error: None,
        checksum,
    })
}

unsafe extern "C" fn finalize_vec(
    _env: napi::sys::napi_env,
    _data: *mut std::ffi::c_void,
    hint: *mut std::ffi::c_void,
) {
    if !hint.is_null() {
        drop(Box::from_raw(hint as *mut Vec<u8>));
    }
}

/// JS-allocated Buffer into native — always allowed; measures iteration cost.
#[napi]
pub fn sum_js_buffer(buf: Buffer) -> Result<SumOut> {
    let t0 = std::time::Instant::now();
    let mut s: u64 = 0;
    for b in buf.iter() {
        s += *b as u64;
    }
    Ok(SumOut {
        sum: s as f64,
        ms: t0.elapsed().as_secs_f64() * 1000.0,
        len: buf.len() as u32,
    })
}

/// Copy out: Rust allocates, napi Buffer::from copies into JS heap under cage.
#[napi]
pub fn alloc_rust_buffer(n: u32) -> Result<Buffer> {
    let mut v = vec![0u8; n as usize];
    for (i, b) in v.iter_mut().enumerate() {
        *b = (i % 251) as u8;
    }
    Ok(Buffer::from(v))
}

#[napi]
pub fn roundtrip_copy(buf: Buffer) -> Result<Buffer> {
    Ok(Buffer::from(buf.to_vec()))
}

#[napi]
pub fn probe_info() -> String {
    "zerocopy_probe".into()
}
