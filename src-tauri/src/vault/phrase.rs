//! BIP39 word phrases: generated Master Passwords and Recovery Phrases.

use bip39::{Language, Mnemonic};

use crate::error::AppError;

/// A Recovery Phrase carries 256 bits of entropy.
pub const RECOVERY_WORDS: usize = 24;

/// Word counts BIP39 allows, and the ones offered for a generated password.
const PASSWORD_WORD_COUNTS: [usize; 2] = [12, 24];

fn generate(word_count: usize) -> Result<String, AppError> {
    // BIP39: 4 bytes of entropy per 3 words.
    let mut entropy = vec![0u8; word_count / 3 * 4];
    getrandom::fill(&mut entropy).map_err(|error| AppError::Crypto(error.to_string()))?;

    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    Ok(mnemonic.to_string())
}

/// A new random phrase to use as a Master Password.
pub fn generate_password_phrase(word_count: usize) -> Result<String, AppError> {
    if !PASSWORD_WORD_COUNTS.contains(&word_count) {
        return Err(AppError::InvalidInput(
            "a word phrase has 12 or 24 words".into(),
        ));
    }
    generate(word_count)
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

/// A Master Password typed as a BIP39 phrase is stored in its canonical form,
/// so capitals and stray spaces do not matter. Any other password is kept
/// exactly as typed.
pub fn canonical_password(input: &str) -> String {
    canonical_phrase(input).unwrap_or_else(|| input.to_string())
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
    fn generates_the_requested_number_of_words() {
        assert_eq!(generate_password_phrase(12).unwrap().split(' ').count(), 12);
        assert_eq!(generate_password_phrase(24).unwrap().split(' ').count(), 24);
        assert_eq!(
            generate_recovery_phrase().unwrap().split(' ').count(),
            RECOVERY_WORDS
        );
    }

    #[test]
    fn other_word_counts_are_rejected() {
        assert!(generate_password_phrase(13).is_err());
        assert!(generate_password_phrase(0).is_err());
    }

    #[test]
    fn generated_phrases_are_valid_and_different_each_time() {
        let first = generate_password_phrase(12).unwrap();
        let second = generate_password_phrase(12).unwrap();

        assert_eq!(canonical_phrase(&first).as_deref(), Some(first.as_str()));
        assert_ne!(first, second);
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
    fn ordinary_passwords_are_left_alone() {
        assert_eq!(canonical_password("Correct Horse Battery"), "Correct Horse Battery");
        assert_eq!(canonical_password(&ZERO_PHRASE.to_uppercase()), ZERO_PHRASE);
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
