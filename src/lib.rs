mod utils;
mod zip_archiver; // Add the crate name as a prefix to the import statement

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::*;

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
pub fn create_zip_object() -> JsValue {
    let archve = zip_archiver::ZipArchiver::ZipArchiver::new();
    let boxed_zip = Box::new(archve);
    let boxed_zip_ptr = Box::into_raw(boxed_zip);
    JsValue::from(boxed_zip_ptr as u32)
}

#[wasm_bindgen]
pub async fn add_file(zip_ptr: JsValue, name: &str, file: &[u8]) -> Result<(), JsValue> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut zip_archiver::ZipArchiver::ZipArchiver;
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
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut zip_archiver::ZipArchiver::ZipArchiver;
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
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut zip_archiver::ZipArchiver::ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    let data = zip.finish();
    data
}
