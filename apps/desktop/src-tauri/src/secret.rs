//! Keychain wrapper over the `keyring` crate. Service "si.taloslabs.desktop", account = secret name.

pub const SERVICE: &str = "si.taloslabs.desktop";

/// The only names the webview may read, write or delete. Everything else is Rust-only.
pub const WEBVIEW_SECRET_NAMES: &[&str] = &["anthropic_api_key"];

fn webview_allowed(name: &str) -> Result<(), String> {
    if WEBVIEW_SECRET_NAMES.contains(&name) {
        Ok(())
    } else {
        Err("invalid secret name".to_owned())
    }
}

/// The `secret_get` command body: refuses any name outside the webview allow-list.
pub fn webview_get(name: &str) -> Result<Option<String>, String> {
    webview_allowed(name)?;
    get(name)
}

pub fn webview_set(name: &str, value: &str) -> Result<(), String> {
    webview_allowed(name)?;
    set(name, value)
}

pub fn webview_delete(name: &str) -> Result<(), String> {
    webview_allowed(name)?;
    delete(name)
}

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

    #[test]
    fn the_webview_only_reaches_the_api_key() {
        assert_eq!(WEBVIEW_SECRET_NAMES, &["anthropic_api_key"]);
        for name in [
            "chatgpt_refresh_token",
            "chatgpt_access_token",
            "chatgpt_client_id",
            "chatgpt_scope",
            "chatgpt_token_expires_at",
            "",
        ] {
            assert_eq!(
                webview_get(name),
                Err("invalid secret name".to_owned()),
                "{name:?}"
            );
            assert_eq!(
                webview_set(name, "x"),
                Err("invalid secret name".to_owned())
            );
            assert_eq!(webview_delete(name), Err("invalid secret name".to_owned()));
        }
        assert!(
            valid_name("chatgpt_refresh_token"),
            "Rust itself may use it"
        );
    }
}
