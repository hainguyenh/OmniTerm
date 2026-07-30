# Credential-storage audit

**Scope:** does OmniTerm store a password, or any other credential, anywhere — and would a security
scan of this repository or the shipped binary turn up something the project's own claims do not
account for.

**Date:** 2026-07-30 · **Commit:** `7ad564e` · **Verdict:** the app itself persists no credential.
Three items below need attention: one documentation inaccuracy, one stale comment that contradicts its
own code, and one bug.

This document reports findings only. No code was changed in response to it.

---

## 1. What the app genuinely does not store — verified

Each of these was checked in the code, not taken from a comment:

| Claim | Where | How it is enforced |
| --- | --- | --- |
| No password in the connection tree | `src-tauri/src/connections.rs:22` | `Connection` has no password field. `save_connections` serializes from the struct (`:207`), so a webview that posts an extra `password` key has it dropped at deserialization rather than written to disk. |
| Legacy plaintext is removed | `connections.rs:151`, called at `lib.rs:106` | `scrub_stored_secrets` runs at startup, before the renderer can request the tree, and rewrites `connections.json` through a type that has no field for a secret. Keys it looks for are named explicitly at `:128`. |
| Encrypted vault backups are refused, not decrypted | `connections.rs:235` | The `encrypted: true` check runs *first*, before the tree parse — necessary because both `ConnectionTree` fields are `#[serde(default)]`, so any JSON object would otherwise deserialize as an empty tree. |
| Imports drop secrets at the door | `connections.rs:253` | An imported file round-trips through `ConnectionTree` before reaching the webview, so a file exported by a build that did save passwords imports metadata only. |
| No credential in generated `.rdp` | `rdp_embed.rs:23-26`, `:98` | No `password 51:b:` blob, no `prompt for credentials`, no `cmdkey`, nothing on the command line. |
| SSH auth stays interactive | `pty_resolve.rs:111`, `omnitermAPI.ts:133` | `ssh.exe` runs under ConPTY and prompts in the terminal; no credential crosses the frontend API. |
| No sudo-password helper | `TerminalView.tsx:196` | Removed deliberately — it used to type a stored credential into the pane. |
| Session output is not persisted | `session_output.rs:24` | A 256 KB in-memory ring buffer for pop-out replay. No transcript is written to disk, so a password typed at a prompt is not captured anywhere. |
| Release builds write no log | `app_utils.rs`, guarded by `src/__tests__/release-no-logging.test.ts` | Logging is compiled behind `debug_assertions`. |
| Stock installer ships no plugin | `src-tauri/tauri.conf.json:42` | `resources` is `builtinThemes/*` + `sidecar/*.cjs`. The reference plugins under `plugins/` are not bundled. |

## 2. Finding — the shipped binary contains working credential storage

**Severity: needs a decision, not necessarily a fix.**

`src-tauri/src/credential_vault.rs` is a complete Windows Credential Manager client: `CredWriteW`
with `CRED_PERSIST_LOCAL_MACHINE` (`:34-53`), `CredReadW` (`:61`), `CredDeleteW` (`:99`), and a
native credential prompt (`:118`). It is compiled into every Windows build and reachable from a stock
install by three paths:

1. `prompt_save_connection_credential` — a registered Tauri command (`lib.rs:197`, implementation
   `lib.rs:280`).
2. `credentials.get` / `.set` / `.delete` over the sidecar reverse-RPC (`plugin_host_api.rs:70-88`).
3. `OmniTerm.exe` in `SSH_ASKPASS` mode (`main.rs:5-12`), which reads the vault and prints the secret
   to stdout.

All three are gated: a plugin must be installed, be the active connection provider, and declare the
`credentials` permission (`lib.rs:311-320`, `plugin_management.rs:24`). The reference plugin
`@omniterm/full-connection-manager` declares it. The UI surfaces this as a
**"Save in Windows Credential Manager"** radio at `ConnectionForm.tsx:381`.

**Why this matters for a scan.** The design is defensible — the secret goes to the OS vault, never to
a file OmniTerm owns, and the user types it into a native Windows dialog that the webview never sees
(`ConnectionForm.tsx:385`). But the project states something stronger than that:

- `README.md:33` — "OmniTerm never saves a password, in any form, anywhere"
- `docs/PLUGINS.md:21` — "Credentials: OmniTerm stores no password" / "The host never holds a
  password, in any form, anywhere"

A reviewer who greps for `CredWrite` and then reads those two sentences will not conclude "acceptable
OS-vault delegation." The accurate claim is narrower and still strong: *OmniTerm stores no credential
itself; a plugin may delegate storage to the OS vault, and the host never holds the plaintext.*

Options, in increasing cost: reword the two docs to the accurate claim; or put the vault, the command,
the askpass mode and the `ConnectionForm` radio behind an off-by-default Cargo feature so a stock scan
finds no `CredWriteW` at all — which would break `full-connection-manager` on stock builds.

## 3. Finding — a comment that contradicts its own code

**Severity: fix regardless of the decision in §2. This is the worst artifact to leave in place.**

`src-tauri/sidecar/host-api.cjs:88-99` documents the stock `CredentialStore` as a refusal:

> The host stores no secret. This is the stock `CredentialStore`, and it is deliberately a refusal
> rather than an implementation — OmniTerm never holds a password in any form, so there is nothing
> behind these methods and `isAvailable()` says so. […] `set` now rejects, so a caller cannot mistake
> "not stored" for "stored".

The code immediately below it does the opposite. `isAvailable()` returns
`process.platform === 'win32'` (`:103`) — true on the target platform — and `set` forwards to
`credentials.set` (`:109-112`), which `plugin_host_api.rs:77` implements against Credential Manager.
The comment describes a state the code left behind when the Rust side was implemented.

An auditor who finds a security comment asserting the opposite of its code will stop trusting every
other comment in the repository, including the accurate ones in §1 — several of which are the only
in-code record of *why* a guard exists.

## 4. Finding — hardcoded plugin id in the askpass handoff

**Severity: functional bug, not a leak.**

`pty_resolve.rs:172` sets `OMNITERM_ASKPASS_PLUGIN=@omniterm/full-connection-manager` as a literal,
rather than the id of the provider that actually stored the credential. Any other provider using
`hasStoredCredential` gets a vault lookup under the wrong namespace — `credential_vault::target()`
builds `OmniTerm/{plugin_id}/{key}` (`:15`) — so `CredRead` returns `ERROR_NOT_FOUND`, `main.rs:8`
prints nothing, and `ssh.exe` falls back to prompting. Degrades safely; still wrong.

## 5. Notes — reviewed, no action proposed

- **`SSH_ASKPASS` env vars are visible to other processes.** `pty_resolve.rs:169-174` sets them on a
  `cmd` command line. They name a vault *key*, never a secret, and the helper fetches the value
  itself — so the design correctly keeps the password off argv, where any process on the machine
  could read it.
- **Anyone can run the askpass mode.** `main.rs:5-12` reads the vault from env vars alone, with no
  check that the caller is `ssh.exe`. Not a boundary crossing: a process running as this user could
  call `CredRead` directly and get the same result. Worth knowing before someone reports it as one.
- **`CRED_PERSIST_LOCAL_MACHINE`** (`credential_vault.rs:48`) stores in the user's own credential set
  and is not roamed — it is not a cross-user exposure.
- **`--test/plugins/@omniterm/connection-manager/storage/`** exists in the working tree and is empty.
  It is a leftover test path, not tracked content.
- **Plugin-side obfuscation.** `plugins/full-connection-manager/src/store.ts:5` describes its at-rest
  scheme as "obfuscation-at-rest […] not a cryptographic secret against someone who also holds the
  plugin binary," which matches `docs/PLUGINS.md:59`. Accurately labelled.

## 6. Suggested regression guards

The §1 properties are enforced by construction today but nothing fails if that changes. Worth
considering:

- A test asserting `Connection` has no field whose name matches `/pass|secret|cred/` — `Connection`
  having no password field is load-bearing for `save_connections`, `parse_import_content`,
  `generate_rdp_content` and the plugin resolve path all at once.
- A grep-style test that `generate_rdp_content` output contains no `password` key, paired with the
  existing `rdp_embed_tests.rs` cases.
- A test that `host-api.cjs`'s stated credential behaviour matches whether `plugin_host_api.rs`
  implements `credentials.set` — the §3 drift would have been caught by it.
