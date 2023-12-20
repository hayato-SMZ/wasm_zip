use std::io::{self, Cursor, Write};

pub(crate) use zip::{result::ZipResult, write::FileOptions, ZipWriter};

pub struct ZipArchiver {
    options: FileOptions,
    zip: ZipWriter<io::Cursor<Vec<u8>>>,
}

impl Default for ZipArchiver {
    fn default() -> Self {
        Self::new()
    }
}

impl ZipArchiver {
    pub fn new() -> Self {
        let options = FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let buffer = Vec::new();
        let zip = ZipWriter::new(Cursor::new(buffer));
        Self { options, zip }
    }

    pub fn add_file(&mut self, name: &str, data: &[u8]) -> ZipResult<()> {
        self.zip.start_file(name, self.options)?;
        self.zip.write_all(data)?;
        Ok(())
    }

    pub fn add_dir(&mut self) -> ZipResult<()> {
        self.zip.add_directory("name", self.options)?;
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
