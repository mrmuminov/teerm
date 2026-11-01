use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::error::AppError;

/// Write `bytes` to `path` via a temporary file and an atomic rename.
/// The previous revision is kept as `<file>.bak` on a best-effort basis.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidInput("path has no parent directory".into()))?;
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::InvalidInput("path has no file name".into()))?;

    let mut tmp_name = file_name.to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = parent.join(tmp_name);

    let mut tmp_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&tmp_path)?;
    tmp_file.write_all(bytes)?;
    tmp_file.sync_all()?;
    drop(tmp_file);

    if path.exists() {
        let mut backup_name = file_name.to_os_string();
        backup_name.push(".bak");
        let backup_path = parent.join(backup_name);
        let _ = fs::copy(path, backup_path);
    }

    fs::rename(&tmp_path, path)?;

    // Make the rename durable on Unix. Windows does not allow opening a
    // directory as a file, so this is a no-op there.
    #[cfg(unix)]
    {
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }

    Ok(())
}
