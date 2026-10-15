//! Global password policy from `pwpolicy getaccountpolicies`.

use std::sync::atomic::AtomicBool;
use std::sync::LazyLock;

use regex::Regex;

use super::{check_exit, lit, run};
use crate::collect::{to_section, Fail};
use crate::exec::Bin;
use crate::state::{PasswordPolicy, Section};

static MIN_LENGTH_RE: LazyLock<Regex> = LazyLock::new(|| lit(r"\.\{(\d+),\}"));
static MAX_FAILED_RE: LazyLock<Regex> = LazyLock::new(|| lit(r"policyAttributeFailedAuthentications\s*<\s*(\d+)"));

fn policy_contents<'a>(dict: &'a plist::Dictionary, category: &str) -> impl Iterator<Item = &'a str> + 'a {
    dict.get(category)
        .and_then(plist::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(plist::Value::as_dictionary)
        .filter_map(|d| d.get("policyContent"))
        .filter_map(plist::Value::as_string)
}

/// Skips the "Getting global account policies" preamble, then reads the XML plist.
pub fn parse_pwpolicy(text: &str) -> Result<PasswordPolicy, Fail> {
    let xml_start = text.lines().position(|l| l.trim_start().starts_with("<?xml"));
    let Some(start) = xml_start else {
        return Ok(PasswordPolicy { min_length: None, max_failed_attempts: None });
    };
    let xml: Vec<&str> = text.lines().skip(start).collect();
    let xml = xml.join("\n");
    let value = plist::Value::from_reader_xml(xml.as_bytes()).map_err(|_| Fail::parse("pwpolicy"))?;
    let dict = value.as_dictionary().ok_or_else(|| Fail::parse("pwpolicy"))?;
    let min_length = policy_contents(dict, "policyCategoryPasswordContent")
        .find_map(|c| MIN_LENGTH_RE.captures(c))
        .and_then(|caps| caps.get(1).and_then(|m| m.as_str().parse().ok()));
    let max_failed_attempts = policy_contents(dict, "policyCategoryAuthentication")
        .find_map(|c| MAX_FAILED_RE.captures(c))
        .and_then(|caps| caps.get(1).and_then(|m| m.as_str().parse().ok()));
    Ok(PasswordPolicy { min_length, max_failed_attempts })
}

fn inner(cancel: &AtomicBool) -> Result<PasswordPolicy, Fail> {
    let out = run(Bin::Pwpolicy, &["getaccountpolicies"], cancel)?;
    check_exit(&out, Bin::Pwpolicy)?;
    parse_pwpolicy(&out.stdout)
}

pub fn collect(cancel: &AtomicBool) -> Section<PasswordPolicy> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_stock_policy() {
        let text = include_str!("../../../tests/fixtures/pwpolicy.txt");
        assert!(text.starts_with("Getting global account policies\n"));
        let policy = parse_pwpolicy(text).unwrap();
        assert_eq!(policy, PasswordPolicy { min_length: Some(4), max_failed_attempts: None });
    }

    #[test]
    fn parses_cis_policy_with_lockout() {
        let text = r#"Getting global account policies
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>policyCategoryAuthentication</key>
	<array>
		<dict>
			<key>policyContent</key>
			<string>(policyAttributeFailedAuthentications &lt; policyAttributeMaximumFailedAuthentications) OR (policyAttributeCurrentTime &gt; (policyAttributeLastFailedAuthenticationTime + autoEnableInSeconds))</string>
		</dict>
		<dict>
			<key>policyContent</key>
			<string>policyAttributeFailedAuthentications &lt; 10</string>
		</dict>
	</array>
	<key>policyCategoryPasswordContent</key>
	<array>
		<dict>
			<key>policyContent</key>
			<string>policyAttributePassword matches '.{15,}'</string>
		</dict>
	</array>
</dict>
</plist>
"#;
        let policy = parse_pwpolicy(text).unwrap();
        assert_eq!(policy, PasswordPolicy { min_length: Some(15), max_failed_attempts: Some(10) });
    }

    #[test]
    fn no_plist_gives_nulls_and_bad_xml_fails() {
        assert_eq!(parse_pwpolicy("Getting global account policies\n").unwrap(), PasswordPolicy { min_length: None, max_failed_attempts: None });
        assert!(parse_pwpolicy("Getting global account policies\n<?xml version=\"1.0\"?>\n<plist><dict>").is_err());
    }
}
