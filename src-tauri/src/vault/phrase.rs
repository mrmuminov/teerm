//! BIP39 Recovery Phrases.

use bip39::{Language, Mnemonic};

use crate::error::AppError;

/// A Recovery Phrase carries 256 bits of entropy.
pub const RECOVERY_WORDS: usize = 24;

fn generate(word_count: usize) -> Result<String, AppError> {
    // BIP39: 4 bytes of entropy per 3 words.
    let mut entropy = vec![0u8; word_count / 3 * 4];
    getrandom::fill(&mut entropy).map_err(|error| AppError::Crypto(error.to_string()))?;

    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    Ok(mnemonic.to_string())
}

/// A new random Recovery Phrase.
pub fn generate_recovery_phrase() -> Result<String, AppError> {
    generate(RECOVERY_WORDS)
}

/// The phrase in lowercase with single spaces, if it is a valid BIP39 phrase
/// (known words and a correct checksum); `None` otherwise.
pub fn canonical_phrase(input: &str) -> Option<String> {
    let normalized = input
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ");

    Mnemonic::parse_in_normalized(Language::English, &normalized)
        .ok()
        .map(|mnemonic| mnemonic.to_string())
}

/// The canonical form of a Recovery Phrase typed by the user.
pub fn canonical_recovery_phrase(input: &str) -> Result<String, AppError> {
    canonical_phrase(input).ok_or(AppError::InvalidRecoveryPhrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO_PHRASE: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn a_recovery_phrase_has_24_valid_words() {
        let recovery = generate_recovery_phrase().unwrap();

        assert_eq!(recovery.split(' ').count(), RECOVERY_WORDS);
        assert_eq!(canonical_phrase(&recovery).as_deref(), Some(recovery.as_str()));
    }

    #[test]
    fn generated_phrases_differ_each_time() {
        assert_ne!(
            generate_recovery_phrase().unwrap(),
            generate_recovery_phrase().unwrap()
        );
    }

    #[test]
    fn canonical_form_ignores_case_and_spacing() {
        let messy = format!("  {}  ", ZERO_PHRASE.to_uppercase().replace(' ', "   "));

        assert_eq!(canonical_phrase(&messy).as_deref(), Some(ZERO_PHRASE));
    }

    #[test]
    fn a_bad_checksum_or_unknown_word_is_not_a_phrase() {
        let wrong_checksum = ZERO_PHRASE.replace("about", "abandon");

        assert_eq!(canonical_phrase(&wrong_checksum), None);
        assert_eq!(canonical_phrase("not a bip39 phrase at all"), None);
        assert_eq!(canonical_phrase(""), None);
    }

    #[test]
    fn a_recovery_phrase_must_be_valid() {
        assert!(matches!(
            canonical_recovery_phrase("one two three"),
            Err(AppError::InvalidRecoveryPhrase)
        ));
        assert_eq!(canonical_recovery_phrase(ZERO_PHRASE).unwrap(), ZERO_PHRASE);
    }
}
