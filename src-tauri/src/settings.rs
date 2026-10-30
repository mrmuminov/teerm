use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::fsutil::atomic_write;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u8,
    pub scrollback: u32,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub copy_on_select: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono".into(),
            font_size: 13,
            scrollback: 10_000,
            cursor_style: "block".into(),
            cursor_blink: true,
            copy_on_select: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub app_theme: String,
    pub language: String,
    pub auto_lock_minutes: u32,
    pub download_dir: Option<String>,
    pub strict_host_key_checking: bool,
    pub sftp_show_hidden: bool,
    pub terminal: TerminalSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            app_theme: "dark".into(),
            language: "en".into(),
            auto_lock_minutes: 15,
            download_dir: None,
            strict_host_key_checking: false,
            sftp_show_hidden: false,
            terminal: TerminalSettings::default(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }

        match fs::read_to_string(path) {
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(settings) => settings,
                Err(error) => {
                    eprintln!("could not parse settings: {error}");
                    Self::default()
                }
            },
            Err(error) => {
                eprintln!("could not read settings: {error}");
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), AppError> {
        let contents = serde_json::to_vec_pretty(self)?;
        atomic_write(path, &contents)
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.app_theme.as_str(), "dark" | "light" | "system") {
            return Err(AppError::InvalidInput("unknown app theme".into()));
        }
        if self.language.trim().is_empty() || self.language.len() > 16 {
            return Err(AppError::InvalidInput("invalid language".into()));
        }
        if self.auto_lock_minutes > 24 * 60 {
            return Err(AppError::InvalidInput(
                "auto-lock timeout is too large".into(),
            ));
        }
        if !(8..=32).contains(&self.terminal.font_size) {
            return Err(AppError::InvalidInput(
                "terminal font size must be between 8 and 32".into(),
            ));
        }
        if !(100..=1_000_000).contains(&self.terminal.scrollback) {
            return Err(AppError::InvalidInput(
                "terminal scrollback must be between 100 and 1,000,000".into(),
            ));
        }
        if !matches!(
            self.terminal.cursor_style.as_str(),
            "block" | "bar" | "underline"
        ) {
            return Err(AppError::InvalidInput("unknown cursor style".into()));
        }
        if self.terminal.font_family.trim().is_empty()
            || self.terminal.font_family.len() > 100
        {
            return Err(AppError::InvalidInput("invalid terminal font family".into()));
        }

        Ok(())
    }
}
