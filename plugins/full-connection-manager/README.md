# Full Remote Suite

Windows connection provider for OmniTerm with workspace-scoped SSH/RDP profiles: a connection is
saved in the project folder it belongs to and appears in that folder's tree in the Workspace panel.

- SSH opens inside an OmniTerm ConPTY pane and supports reconnect, input, and resize.
- RDP opens through the native Windows Remote Desktop client.
- Optional passwords are entered through a native Windows dialog and stored only in Windows
  Credential Manager. The Tauri webview never receives a password.
- Connection exports contain metadata only. Credentials remain machine/user scoped.

SFTP capability metadata is reserved for the graphical transfer transport. Until that transport is
connected, users authenticate and transfer files with the native SSH tools in the terminal.
