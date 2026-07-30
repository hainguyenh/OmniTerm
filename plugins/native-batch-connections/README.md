# Limited Connections

Restricted, password-free Windows SSH and RDP connection provider for OmniTerm.

Every connection is a generated `.bat` launcher executed by Windows `cmd.exe`. SSH calls the built-in
Windows OpenSSH client and RDP calls `mstsc.exe /v:"host:port" /public /prompt`. The launcher contains
only versioned connection metadata and a native command. The plugin declares no credential permission,
never renders a password control, and never accepts or stores a password.

An optional HTTPS password-help page can be saved with a connection. The plugin opens that page
immediately before the BAT launcher runs so the user can retrieve a password from a company vault.
The URL is metadata; no password is read, copied, appended to the command, or stored by OmniTerm.
