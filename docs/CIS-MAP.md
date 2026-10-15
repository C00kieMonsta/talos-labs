# CIS Apple macOS Benchmark section map

Source of truth for every `cis` field in the rules catalog. Numbers are taken from the
NIST macOS Security Compliance Project rule files on the `tahoe` branch
(https://github.com/usnistgov/macos_security/tree/tahoe/rules), which carry the
section numbers of the CIS Apple macOS 26 Tahoe Benchmark. Verified 2026-10-15.
The Sequoia (macOS 15) edition uses the same numbers for every row checked.

Older editions (Sonoma and earlier) number some sections differently
(for example Users & Groups was 2.12.x, Gatekeeper 2.6.4). Do not use those.

| Area | Control | CIS section | Level | mSCP rule |
|---|---|---|---|---|
| Updates | Software Update is current (no pending update) | 1.1 | 1 | system_settings_softwareupdate_current |
| Updates | Download new updates automatically | 1.2 | 1 | system_settings_software_update_download_enforce |
| Updates | Install macOS updates automatically | 1.3 | 1 | system_settings_install_macos_updates_enforce |
| Updates | Install App Store app updates automatically | 1.4 | 1 | os_software_update_app_update_enforce |
| Updates | Install security responses and system files automatically | 1.5 | 1 | system_settings_critical_update_install_enforce, os_config_data_install_enforce |
| Network | Application firewall enabled | 2.2.1 | 1 | system_settings_firewall_enable |
| Network | Firewall stealth mode enabled | 2.2.2 | 1 | system_settings_firewall_stealth_mode_enable |
| Sharing | AirDrop disabled | 2.3.1.1 | 1 | os_airdrop_disable |
| Sharing | Screen Sharing and Apple Remote Desktop disabled | 2.3.3.1 | 1 | system_settings_screen_sharing_disable |
| Sharing | File Sharing (SMB) disabled | 2.3.3.2 | 1 | system_settings_smbd_disable |
| Sharing | Printer Sharing disabled | 2.3.3.3 | 1 | system_settings_printer_sharing_disable |
| Sharing | Remote Login (SSH) disabled | 2.3.3.4 | 1 | system_settings_ssh_disable |
| Sharing | Remote Management disabled | 2.3.3.5 | 1 | system_settings_remote_management_disable |
| Sharing | Remote Apple Events disabled | 2.3.3.6 | 1 | system_settings_rae_disable |
| Sharing | Internet Sharing disabled | 2.3.3.7 | 1 | system_settings_internet_sharing_disable |
| Sharing | Content Caching disabled | 2.3.3.8 | 2 | system_settings_content_caching_disable |
| Sharing | Media Sharing disabled | 2.3.3.9 | 2 | system_settings_media_sharing_disabled |
| Sharing | Bluetooth Sharing disabled | 2.3.3.10 | 1 | system_settings_bluetooth_sharing_disable |
| Backup | Time Machine automatic backups enabled | 2.3.4.1 | 2 | system_settings_time_machine_auto_backup_enable |
| Privacy & Security | Gatekeeper enabled | 2.6.5 | 1 | os_gatekeeper_enable |
| Privacy & Security | FileVault enabled | 2.6.6 | 1 | system_settings_filevault_enforce |
| Lock Screen | Screen saver starts within 20 minutes | 2.11.1 | 1 | system_settings_screensaver_timeout_enforce |
| Lock Screen | Password required after screen saver or sleep (delay <= 5 s) | 2.11.2 | 1 | system_settings_screensaver_password_enforce, system_settings_screensaver_ask_for_password_delay_enforce |
| Users & Groups | Guest account disabled | 2.13.1 | 1 | system_settings_guest_account_disable |
| Users & Groups | Guest access to shared folders disabled | 2.13.2 | 1 | system_settings_guest_access_smb_disable |
| Users & Groups | Automatic login disabled | 2.13.3 | 1 | system_settings_automatic_login_disable |
| System | System Integrity Protection enabled | 5.1.2 | 1 | os_sip_enable |
| Passwords | Minimum password length (CIS asks for 15) | 5.2.2 | 1 | pwpolicy_minimum_length_enforce |
| System | Antivirus present (XProtect counts for a consumer Mac) | 5.10 | 1 | os_anti_virus_installed |

Controls with no CIS section (use `cis: null`): standard vs admin daily account,
listening ports exposed on all interfaces, third-party launch agents and daemons,
login items, backup recency, browser extensions, SSH key passphrases, ~/.ssh
permissions, secrets in dotfiles.
