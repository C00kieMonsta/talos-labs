# The TCP socket table is empty for ad-hoc signed builds

Verified on macOS 27.0.1 arm64 on 2026-10-15. Affects the listeners,
remoteAccess and fileSharing sections (the last two reuse the listener table).

## What was measured

`sysctl net.inet.tcp.pcblist_n` is what netstat reads. The kernel reports the
socket count but returns no records when the calling process (or an ancestor
it was spawned from) is ad-hoc signed:

| caller | signature | result |
|---|---|---|
| zsh, perl, sysctl, netstat run from a shell | Apple | full table, 28 LISTEN rows |
| node from nvm (official Node.js binary) spawning netstat | Developer ID Application, hardened runtime | full table |
| Homebrew python3 spawning netstat | ad-hoc | empty |
| cc-built C program spawning netstat | ad-hoc, linker-signed | empty |
| cc-built C program calling sysctlbyname directly | ad-hoc | `xig_count` 111 but only the 48-byte header returned |
| same program re-signed ad-hoc with the hardened runtime | ad-hoc | empty |
| same program re-signed ad-hoc with get-task-allow | ad-hoc | empty |
| same program with the signature removed | none | killed by the kernel (arm64) |
| `target/debug/talos-collect` (cargo, ad-hoc linker-signed) | ad-hoc | empty |

The Claude Code sandbox was ruled out: the results are identical with it off.
Root was not involved in any run. The filter lives in the kernel, not in
netstat, so reading the sysctl directly from Rust would not help. A
self-signed identity was not tested because that means adding a certificate to
the login keychain.

## Consequences

- `pnpm tauri dev` and any unsigned CI build show these three sections as
  "Couldn't check". Rules 018 to 022 come back `unknown`, never a false pass.
- Release builds are signed with a Developer ID (see docs/SIGNING.md), which is
  the signature class that worked here. Confirm on the first signed build and
  record the result in this file.
- For local development with a Developer ID certificate installed:
  `codesign -s "Developer ID Application: <name>" --options runtime
  apps/desktop/src-tauri/target/debug/talos-collect` and run it from a
  Terminal. The same works for the debug app bundle.
- `lsof` is not a fallback: without root it lists only the current user's
  processes, so launchd's listeners on 22, 445 and 5900 would be invisible and
  rules 019 to 022 would pass falsely. Keep the section unavailable instead.

## Collector behaviour

The collector maps netstat's empty table to `unavailable` with reason
`permission_denied` and detail `netstat: empty socket table`. The UI should say
that this build is not signed so macOS hides the network socket list, and that
signed releases do not have this limit.

## If the struct layouts are ever needed

The private records behind `pcblist_n` are in apple-oss-distributions/xnu:
`bsd/netinet/in_pcb.h` (xinpgen, xinpcb_n), `bsd/netinet/tcp_var.h`
(xtcpcb_n), `bsd/sys/socketvar.h` (xsocket_n and the XSO_* kinds).
netstat's walk is `protopr` in network_cmds/netstat.tproj/inet.c. Sizes
measured with clang on this SDK: xinpgen 24, xinpcb_n 112; offsets
inp_lport 18, inp_vflag 48, inp_dependladdr 68 in xinpcb_n, t_state 36 in
xtcpcb_n, so_last_pid 72 in xsocket_n. Not used by the app.
