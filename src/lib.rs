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
    let archve = ZipArchiver::new(compression_level as i64);
    let boxed_zip = Box::new(archve);
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
