//! Keychain wrapper over the `keyring` crate. Service "si.taloslabs.desktop", account = secret name.

pub const SERVICE: &str = "si.taloslabs.desktop";

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !valid_name(name) {
        return Err("invalid secret name".to_owned());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    entry(name)?.set_password(value).map_err(|e| e.to_string())
}

pub fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_restricted() {
        assert!(valid_name("anthropic_api_key"));
        assert!(!valid_name(""));
        assert!(!valid_name("Anthropic Key"));
        assert!(!valid_name("../x"));
        assert!(get("bad name").is_err());
    }
}
