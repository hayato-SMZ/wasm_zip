mod utils;
mod zip_archiver;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::*;
use zip_archiver::ZipArchiver;

#[wasm_bindgen]
#[derive(Serialize, Deserialize, Debug)]
pub struct ZipItem {
    name: String,
    data: Vec<u8>,
}

#[wasm_bindgen]
impl ZipItem {
    #[wasm_bindgen(constructor)]
    pub fn new(name: String, data: Vec<u8>) -> Self {
        Self { name, data }
    }
}

#[wasm_bindgen]
pub fn create_zip_object(compression_level: i32) -> JsValue {
    utils::set_panic_hook();
    let archive = ZipArchiver::new(compression_level as i64);
    let boxed_zip = Box::new(archive);
    let boxed_zip_ptr = Box::into_raw(boxed_zip);
    JsValue::from(boxed_zip_ptr as u32)
}

#[wasm_bindgen]
pub async fn add_file(zip_ptr: JsValue, name: &str, file: &[u8]) -> Result<(), JsValue> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    let result = zip.add_file(name, file);
    if result.is_err() {
        return Err(JsValue::from_str("add_file error"));
    }
    let _ = Box::into_raw(zip);
    Ok(())
}

#[wasm_bindgen]
pub async fn add_dir(zip_ptr: JsValue, name: &str) -> Result<(), JsValue> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    let result = zip.add_dir(name);
    if result.is_err() {
        return Err(JsValue::from_str("add_dir error"));
    }
    let _ = Box::into_raw(zip);
    Ok(())
}

#[wasm_bindgen]
pub fn finish(zip_ptr: JsValue) -> Vec<u8> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    zip.finish()
}

/// Return the WebAssembly.Memory object so callers can write into Wasm linear
/// memory when using the zero-copy staging API.
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// Allocate a staging buffer inside Wasm linear memory and return its pointer.
/// The caller should write file bytes into `memory.buffer` at this pointer,
/// then call `add_file_from_staging`.
///
/// Returns an error if `len` exceeds the WASM32 single-allocation limit
/// (`isize::MAX` = 2,147,483,647 bytes). Files at or above 2 GiB cannot be
/// held in a single contiguous buffer in 32-bit WASM.
#[wasm_bindgen]
pub fn alloc_staging(len: usize) -> Result<*mut u8, JsValue> {
    if len > isize::MAX as usize {
        return Err(JsValue::from_str(&format!(
            "alloc_staging: requested size ({len} bytes) exceeds the WASM32 \
             per-allocation limit ({} bytes, ~2 GiB - 1). \
             Split the file into smaller chunks.",
            isize::MAX,
        )));
    }
    let mut buf = vec![0u8; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    Ok(ptr)
}

/// Add a file whose bytes have already been written into the Wasm staging buffer
/// allocated by `alloc_staging`. The buffer is freed after this call.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[wasm_bindgen]
pub fn add_file_from_staging(
    zip_ptr: JsValue,
    name: &str,
    ptr: *mut u8,
    len: usize,
) -> Result<(), JsValue> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    let data = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let result = zip.add_file(name, &data);
    let _ = Box::into_raw(zip);
    if result.is_err() {
        return Err(JsValue::from_str("add_file_from_staging error"));
    }
    Ok(())
}
