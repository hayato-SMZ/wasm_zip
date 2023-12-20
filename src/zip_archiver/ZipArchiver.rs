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
        let paths = name.split("/").collect::<Vec<&str>>();
        if paths.len() > 1 {
            let mut path = String::new();
            for i in 0..paths.len() - 2 {
                path.push_str(paths[i]);
                path.push_str("/");
            }
            self.add_dir(&path.as_str())?;
        }
        self.zip.start_file(name, self.options)?;
        self.zip.write_all(data)?;
        Ok(())
    }

    pub fn add_dir(&mut self, path: &str) -> ZipResult<()> {
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
