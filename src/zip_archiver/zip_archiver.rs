use std::io::{self, Cursor, Write};

pub(crate) use zip::{result::ZipResult, write::FileOptions, ZipWriter};

pub struct ZipArchiver {
    options: FileOptions,
    zip: ZipWriter<io::Cursor<Vec<u8>>>,
}

impl ZipArchiver {
    pub fn new(compression_level: i64) -> Self {
        let level = compression_level.clamp(0, 9) as i32;
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(level));
        let buffer = Vec::new();
        let zip = ZipWriter::new(Cursor::new(buffer));
        Self { options, zip }
    }

    pub fn add_file(&mut self, name: &str, data: &[u8]) -> ZipResult<()> {
        self.zip.start_file(name, self.options)?;
        self.zip.write_all(data)?;
        Ok(())
    }

    pub fn add_dir(&mut self, path: &str) -> ZipResult<()> {
        self.zip.add_directory(path, self.options)?;
        Ok(())
    }

    pub fn finish(&mut self) -> Vec<u8> {
        let result = self.zip.finish();
        if result.is_err() {
            return Vec::new();
        } else {
            return result.unwrap().into_inner();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_file_and_finish_produces_valid_zip() {
        let mut archiver = ZipArchiver::new(6);
        archiver.add_file("hello.txt", b"Hello, World!").unwrap();
        let result = archiver.finish();
        assert!(!result.is_empty());
        // ZIPマジックナンバー (PK) を確認
        assert_eq!(&result[0..2], b"PK");
    }

    #[test]
    fn test_deflate_reduces_size_compared_to_no_compression() {
        // 反復データは圧縮効率が高い
        let data = b"Hello, World! ".repeat(200);

        let mut archiver_level0 = ZipArchiver::new(0);
        archiver_level0.add_file("test.txt", &data).unwrap();
        let size_level0 = archiver_level0.finish().len();

        let mut archiver_level6 = ZipArchiver::new(6);
        archiver_level6.add_file("test.txt", &data).unwrap();
        let size_level6 = archiver_level6.finish().len();

        assert!(
            size_level6 < size_level0,
            "level=6 ({} bytes) should be smaller than level=0 ({} bytes)",
            size_level6,
            size_level0
        );
    }

    #[test]
    fn test_higher_level_compresses_more() {
        let data = b"aaaa bbbb cccc dddd eeee ffff ".repeat(200);

        let mut archiver_low = ZipArchiver::new(1);
        archiver_low.add_file("test.txt", &data).unwrap();
        let size_low = archiver_low.finish().len();

        let mut archiver_high = ZipArchiver::new(9);
        archiver_high.add_file("test.txt", &data).unwrap();
        let size_high = archiver_high.finish().len();

        assert!(
            size_high <= size_low,
            "level=9 ({} bytes) should be <= level=1 ({} bytes)",
            size_high,
            size_low
        );
    }

    #[test]
    fn test_compression_level_clamps_high_value() {
        // 範囲外の値でもパニックしないこと
        let mut archiver = ZipArchiver::new(100);
        archiver.add_file("test.txt", b"data").unwrap();
        let result = archiver.finish();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_compression_level_clamps_negative_value() {
        let mut archiver = ZipArchiver::new(-5);
        archiver.add_file("test.txt", b"data").unwrap();
        let result = archiver.finish();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_add_multiple_files() {
        let mut archiver = ZipArchiver::new(6);
        archiver.add_file("a.txt", b"file a content").unwrap();
        archiver.add_file("b.txt", b"file b content").unwrap();
        archiver.add_file("c.txt", b"file c content").unwrap();
        let result = archiver.finish();
        assert_eq!(&result[0..2], b"PK");
    }

    #[test]
    fn test_add_dir() {
        let mut archiver = ZipArchiver::new(6);
        archiver.add_dir("images/").unwrap();
        archiver.add_file("images/photo.jpg", b"fake jpg data").unwrap();
        let result = archiver.finish();
        assert_eq!(&result[0..2], b"PK");
    }

    #[test]
    fn test_empty_zip_is_valid() {
        let mut archiver = ZipArchiver::new(6);
        let result = archiver.finish();
        // 空のZIPでも有効なZIPヘッダーが生成されること
        assert!(!result.is_empty());
        assert_eq!(&result[0..2], b"PK");
    }
}
