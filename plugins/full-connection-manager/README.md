# Full Remote Suite

Workspace-aware SSH/RDP connection provider for OmniTerm.

- Saves connection **metadata only** for personal and workspace scopes.
- Opens SSH inside an OmniTerm ConPTY pane.
- Opens RDP through the native Windows Remote Desktop client.
- Uses `prompt-every-time`; passwords are never accepted or stored by the plugin.
- May open an optional HTTPS authentication-help page before the native prompt.
- Scrubs legacy password-shaped fields when an older metadata file is opened.

The plugin is not password-only, so it remains included after password persistence was removed.
