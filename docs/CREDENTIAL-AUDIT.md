# Password persistence audit

**Updated:** 2026-07-30

## Result

This source tree has no supported path for saving a remote-session password to disk, localStorage, an
OS credential vault, command-line arguments, logs, or plugin-host storage.

Authentication is prompt-only:

- SSH: the user types into the `ssh.exe` prompt inside the terminal.
- RDP: the native Remote Desktop client prompts the user.

## Removed surfaces

The implementation removes:

- the Windows credential-vault Rust module and Windows credential API feature;
- the native save-password dialog command;
- the SSH ASKPASS credential helper path;
- plugin `credentials.get`, `credentials.set`, and `credentials.delete` RPC methods;
- the `HostServices.credentials` API and `credentials` permission;
- frontend `saveCredential` APIs and save-password controls;
- Full Remote Suite password fields, flags, migration logic, and credential store.

## Data model safeguards

`Connection` is metadata-only. It has no password, secret, stored-credential marker, or credential
mode. Provider resolution also returns the same metadata-only type.

Generated RDP files intentionally exclude password directives. SSH passwords travel only as terminal
input to the native SSH process.

## Legacy cleanup

Deletion-only compatibility code remains intentionally:

- The built-in connection loader detects legacy `password` / `hasPassword` keys and rewrites the file
  without them.
- Full Remote Suite strips historical password-shaped keys when reading an older encrypted metadata
  file, then immediately rewrites the cleaned file.

These paths cannot save a new password; they exist only to erase values written by older versions.

## Regression guard

Run:

```bash
pnpm test:security
```

or directly:

```bash
node scripts/check-no-password-persistence.mjs
```

The guard checks that the vault module is absent, the Full plugin has no credential permission, and
known persistence commands/APIs are not present in shipped source.

## Trust boundary

Plugins are unsandboxed Node.js code. OmniTerm exposes no credential-storage API, but a malicious
third-party plugin could independently use Node filesystem or network APIs. Only trusted plugins
should be installed.
