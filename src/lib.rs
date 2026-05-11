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
    // エラー時も ZipArchiver をヒープに戻す。drop するとポインタが dangling になる。
    let _ = Box::into_raw(zip);
    result.map_err(|_| JsValue::from_str("add_file error"))
}

#[wasm_bindgen]
pub async fn add_dir(zip_ptr: JsValue, name: &str) -> Result<(), JsValue> {
    let zip_ptr = zip_ptr.as_f64().unwrap() as usize as *mut ZipArchiver;
    let mut zip = unsafe { Box::from_raw(zip_ptr) };
    let result = zip.add_dir(name);
    let _ = Box::into_raw(zip);
    result.map_err(|_| JsValue::from_str("add_dir error"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    /// staging buffer の確保ロジック本体（テスト専用ヘルパー）。
    fn alloc_staging_inner(len: usize) -> Result<*mut u8, &'static str> {
        if len > isize::MAX as usize {
            return Err("requested size exceeds WASM32 per-allocation limit");
        }
        let mut buf = vec![0u8; len];
        let ptr = buf.as_mut_ptr();
        std::mem::forget(buf);
        Ok(ptr)
    }

    /// staging buffer → ZipArchiver への追加ロジック本体（テスト専用ヘルパー）。
    fn add_file_from_staging_inner(
        archiver: &mut ZipArchiver,
        name: &str,
        ptr: *mut u8,
        len: usize,
    ) -> Result<(), zip::result::ZipError> {
        let data = unsafe { Vec::from_raw_parts(ptr, len, len) };
        archiver.add_file(name, &data)
    }

    // ---- alloc_staging_inner ------------------------------------------------

    #[test]
    fn test_alloc_staging_buffer_is_zeroed() {
        let ptr = alloc_staging_inner(64).unwrap();
        let buf = unsafe { Vec::from_raw_parts(ptr, 64, 64) };
        assert!(buf.iter().all(|&b| b == 0), "staging buffer must be zero-initialized");
    }

    #[test]
    fn test_alloc_staging_empty() {
        // ゼロバイト確保はパニックしない
        let ptr = alloc_staging_inner(0).unwrap();
        let _ = unsafe { Vec::from_raw_parts(ptr, 0, 0) };
    }

    #[test]
    fn test_alloc_staging_size_limit_rejected() {
        // isize::MAX + 1 は拒否される（実際に確保は試みない）
        let result = alloc_staging_inner(isize::MAX as usize + 1);
        assert!(result.is_err(), "isize::MAX + 1 は拒否されるべき");
    }

    #[test]
    fn test_alloc_staging_size_limit_boundary() {
        // チェック条件 `len > isize::MAX` の境界を確認する。
        // isize::MAX 自体は条件を満たさない（= 受け入れ側）、isize::MAX + 1 は満たす（= 拒否側）。
        // 2 GiB の実確保は不可能なのでチェック式の論理を直接検証する。
        let limit: usize = isize::MAX as usize;
        assert!(!(limit > limit), "isize::MAX は拒否条件を満たさない");
        assert!(limit.wrapping_add(1) > limit, "isize::MAX + 1 は拒否条件を満たす");
        // 実際の関数で境界 + 1 が拒否されることを確認
        assert!(alloc_staging_inner(limit + 1).is_err());
        // 合理的なサイズは実際に受け入れられる
        let ptr = alloc_staging_inner(1024).unwrap();
        let _ = unsafe { Vec::from_raw_parts(ptr, 1024, 1024) };
    }

    // ---- staging roundtrip --------------------------------------------------

    #[test]
    fn test_staging_roundtrip_data_integrity() {
        let data = b"Hello from staging buffer!";
        let ptr = alloc_staging_inner(data.len()).unwrap();

        // JS が memory.buffer へ書き込む操作をシミュレート
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, data.len()) };

        let recovered = unsafe { Vec::from_raw_parts(ptr, data.len(), data.len()) };
        assert_eq!(recovered.as_slice(), data);
    }

    #[test]
    fn test_staging_produces_valid_zip() {
        let content = b"wasm-zip staging test content";
        let ptr = alloc_staging_inner(content.len()).unwrap();
        unsafe { std::ptr::copy_nonoverlapping(content.as_ptr(), ptr, content.len()) };

        let mut archiver = ZipArchiver::new(6);
        add_file_from_staging_inner(&mut archiver, "staged.txt", ptr, content.len()).unwrap();
        let zip_bytes = archiver.finish();

        assert_eq!(&zip_bytes[0..2], b"PK", "ZIP マジックナンバーが正しいこと");

        let mut archive = ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
        let mut file = archive.by_name("staged.txt").unwrap();
        let mut actual = Vec::new();
        file.read_to_end(&mut actual).unwrap();
        assert_eq!(actual, content, "ZIP から取り出したデータが元データと一致すること");
    }

    #[test]
    fn test_staging_multiple_files() {
        let files: &[(&str, &[u8])] = &[
            ("a.txt", b"content of file a"),
            ("b.txt", b"content of file b"),
            ("dir/c.txt", b"content of file c in subdir"),
        ];

        let mut archiver = ZipArchiver::new(6);
        for (name, data) in files {
            let ptr = alloc_staging_inner(data.len()).unwrap();
            unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, data.len()) };
            add_file_from_staging_inner(&mut archiver, name, ptr, data.len()).unwrap();
        }
        let zip_bytes = archiver.finish();

        let mut archive = ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
        assert_eq!(archive.len(), files.len());
        for (name, expected) in files {
            let mut file = archive.by_name(name).unwrap();
            let mut actual = Vec::new();
            file.read_to_end(&mut actual).unwrap();
            assert_eq!(&actual, expected);
        }
    }

    #[test]
    fn test_staging_buffer_freed_after_add() {
        // add_file_from_staging_inner 呼び出し後にバッファが二重解放されないことを確認
        // （Vec::from_raw_parts が drop されるため、元のポインタを再利用しない）
        let data = b"free me after use";
        let ptr = alloc_staging_inner(data.len()).unwrap();
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, data.len()) };

        let mut archiver = ZipArchiver::new(6);
        add_file_from_staging_inner(&mut archiver, "freed.txt", ptr, data.len()).unwrap();
        // ここで data Vec は drop 済み。zip_bytes は正しく生成されるはず。
        let zip_bytes = archiver.finish();
        assert_eq!(&zip_bytes[0..2], b"PK");
    }
}
