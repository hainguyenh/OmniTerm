# Writing an OmniTerm plugin

OmniTerm's core is deliberately thin. Saved connections, credential policy, workspace contents and
authentication are all things a plugin can own, so a deployment can replace them without forking the
app. This document is how.

    pnpm create:plugin my-plugin      # scaffold
    pnpm build:plugin ./my-plugin     # compile, and check the host could load it
    pnpm run:plugin ./my-plugin       # load it in the real plugin host and print what the app would see
    pnpm install:plugin ./my-plugin   # copy it where OmniTerm looks, after telling you what it wants

Alternatively, build a plugin ZIP with the wizard and use **Settings → Plugins → Install ZIP**. The
native flow validates the API version, permissions, entry point, archive size, and every extracted
path before copying it. User-installed packages can be removed from the same panel.

Iterate with `build:plugin` + `run:plugin`, and install once it reports `status: loaded` — the app is the
slowest way to find out that a `main` path is wrong. See [Testing and debugging](#testing-and-debugging).

---

## Credentials: OmniTerm stores no password

This is the project's first rule, and it constrains everything below.

**The host never holds a password, in any form, anywhere.** Not in a settings file, not in the
connection tree, not in a `.rdp` file, not on a command line, not in a log, not in an OS vault on your
behalf. The `Connection` type has no field for one, so most of this is enforced by construction rather
than by discipline.

Concretely, for a plugin author:

| | |
|---|---|
| `host.services.credentials.isAvailable()` | returns **`false`** |
| `.get(key)` | resolves `undefined` |
| `.set(key, value)` | **rejects** |
| `.delete(key)` | resolves (a no-op — nothing is stored, so nothing needs removing) |

`set` rejects rather than resolving, and that distinction matters more than it looks. An earlier build
answered these calls with `null`, so `set` resolved successfully while storing nothing. The reference
plugin took that as proof of a write, marked the connection as having a stored secret, and deleted the
plaintext it had just migrated — destroying the user's password. If you write a `CredentialStore`,
**treat only a verified read-back as evidence of a write**, never a resolved `set`.

### Design around it

Two patterns need no storage, and the reference plugin implements both:

- **`credentialMode: 'none'`** — the connection is saved without a secret and the user types the
  password into the session. Nothing to store, nothing to leak.
- **`credentialMode: 'url'`** — the connection records *where* the password lives. On connect, the
  plugin opens that URL so the user copies it from their own vault. OmniTerm never sees the value.

### If you really need storage

Supply your own `CredentialStore` implementation and pass it to your own code — the interface is in the
contract precisely so this is possible. Then it is yours: **protecting what you write is your plugin's
responsibility**, and you should assume a reviewer will ask how. Note that "encrypted with a key
compiled into the plugin" is obfuscation, not protection — anyone with your plugin has the key.

### Never return a secret to the UI

The host passes an invoke result **to the webview verbatim**. Any method reachable from
`registerInvokeHandler` must be renderable-safe by construction. The reference plugin used to expose an
`exportAll` that returned every connection with its password; it is gone. `ConnectionProvider.resolve`
is the *only* place a secret may appear, because it runs in the sidecar and its result goes to the
connection transport, not to the UI.

---

## How plugins run

A plugin is a CommonJS Node package. It runs in the **plugin host sidecar** — a separate `node` process
that Rust spawns and talks to over line-delimited JSON-RPC on stdin/stdout. It does **not** run in the
webview, and it does **not** run in the Rust process.

Practical consequences:

- You have the full Node API: `fs`, `net`, `child_process`. **A plugin runs as the user, with their
  files and their network.** There is no sandbox. This is why both installation paths show what the
  package requests before copying it.
- Node.js must be on `PATH` at runtime. If it isn't, the Plugins panel says so rather than showing an
  empty list.
- Anything you `require` at module top level runs at discovery time, before `activate`.

### Discovery

At startup the sidecar loads every immediate subdirectory of:

    Windows   %APPDATA%\com.omniterm.app\plugins\
    macOS     ~/Library/Application Support/com.omniterm.app/plugins/
    Linux     ${XDG_CONFIG_HOME:-~/.config}/com.omniterm.app/plugins/

A directory qualifies if its `package.json` has an `omnitermPlugin` key. `pnpm install:plugin` just
copies a directory there — you can equally drop one in by hand.

Development builds are explicit: `pnpm tauri:dev:basic`, `pnpm tauri:dev:full`, or
`pnpm tauri:dev:limited`. Basic starts no sidecar when no user plugin is installed. Packaged builds
discover user plugins plus at most the plugin intentionally bundled by the build wizard.

The Settings installer does not accept a path from webview JavaScript. Rust opens the OS picker,
validates the chosen ZIP, and shows a second native permission confirmation. Plugin code is copied
only after that confirmation and is never loaded as a side effect of a renderer-supplied path.

---

## The manifest

```json
{
  "name": "@acme/my-plugin",
  "version": "0.1.0",
  "type": "commonjs",
  "main": "dist/index.js",
  "omnitermPlugin": {
    "apiVersion": 2,
    "hostVersion": ">=0.1.0 <1.0.0",
    "displayName": "My Plugin",
    "permissions": ["connections"]
  }
}
```

- **`main`** must exist after your build. If it doesn't, the plugin loads with
  `status: "error"` and `Main file not found`. `pnpm build:plugin` checks this for you, because the
  alternative is discovering it at app startup.
- **`apiVersion`** must equal the host's (currently `2`) or the plugin is marked `incompatible` and
  **not loaded**. This is checked *before* `require`, since requiring a module runs its top level.
- **`permissions`** is enforced, not documentation — see below.

## Permissions

Every host capability is gated on the manifest. Call one you did not declare and the host throws,
naming both the capability and the permission to add. The scaffold declares **none** on purpose: add
them one at a time as you hit the errors, so what you ship is what you actually use.

| Permission | Unlocks | What the user is agreeing to |
|---|---|---|
| `connections` | `registerConnectionProvider` | Owns the saved connection list: read, change, add. |
| `auth` | `registerAuthProvider` | Gates the whole app. A broken one can lock the user out. |
| `renderer` | `registerInvokeHandler` | Callable from the UI; its return value goes to the UI verbatim. |
| `workspace` | `registerWorkspaceProvider` | Supplies workspaces and workspace-scoped connections. |
| `credentials` | `services.credentials.*` | Asks for secret storage. The host provides none, so these fail. |
| `openExternal` | `services.openExternal` | Opens https URLs in the user's browser. |
| `clipboard` | `services.writeClipboard` | Writes to the clipboard. |

An unrecognised permission makes the plugin `incompatible` rather than being ignored — a manifest that
reads as though something is being checked, when nothing is, is worse than a missing entry.

`services.storageDir` (a private directory for your own files) and `services.log` need no permission.

`storageDir` is `<appData>/com.omniterm.app/plugin-storage/<your-name>` — deliberately *outside* the
`plugins/` tree, so reinstalling or upgrading your plugin does not delete its data. Installing replaces
the install directory wholesale; keep nothing you want to survive inside it.

### openExternal is https-only

The host refuses anything but `https://`, and refuses an authority containing `@`. So no `file:`, no
custom protocol handlers, no bare Windows paths, and no
`https://vault.example@evil.test/` — which reads as `vault.example` to a human and resolves to
`evil.test`. Any https host is allowed, because the host cannot know which vault a deployment uses.

---

## Writing `activate`

```ts
import type { HostAPI, PluginModule } from './types'

export const name = '@acme/my-plugin'

export async function activate(host: HostAPI): Promise<void> {
  host.registerConnectionProvider({
    // Renderer-facing. `Connection` has no credential field, so this cannot leak one.
    load: () => ({ folders: [], connections: [] }),
    save: (tree) => { /* persist it */ },
    // Sidecar-only. The ONE place a secret may appear.
    resolve: async (id) => null,
  })
}

/** Release timers, watchers and handles. Called when the user disables the plugin. */
export function deactivate(): void {}

const plugin: PluginModule = { name, activate, deactivate }
export default plugin
```

The interfaces — `HostAPI`, `HostServices`, `ConnectionProvider`, `AuthProvider`,
`WorkspaceProvider`, `CredentialStore`, `PluginDescriptor`, `PluginPermission` — are defined and
documented in [`contract/index.ts`](../contract/index.ts). Read that file; it is the API reference.

The scaffold copies these types into your plugin as `src/types.ts` rather than importing
`@omniterm/contract`, so your plugin builds standalone as a drop-in package. Keep them in sync with the
contract; the host validates structurally at the `activate(host)` boundary.

### Providers

- **`ConnectionProvider`** — owns the connection tree. When one is registered, it takes over
  `load`/`save`, and `resolve` is consulted at connect time for any id the host cannot answer itself.
- **`AuthProvider`** — optional app-open gate. The host awaits `gate()` before revealing the workspace;
  `true` means authorized. Absent (the default) means no auth, straight to the terminal.
- **`WorkspaceProvider`** — supplies the workspace list and workspace-scoped connections.
- **`registerInvokeHandler`** — plugin-specific RPC reachable from the UI via
  `window.omnitermAPI.plugin.invoke(method, ...args)`. Renderer-safe returns only.

### RDP and other external clients

RDP belongs to a plugin, not to the host. A plugin owning the connection tree can spawn whatever client
it likes from the sidecar — `mstsc`, `freerdp`, `vncviewer` — with whatever credential policy that
deployment wants. The host keeps only a credential-free `mstsc` launch as the no-plugin fallback.

The client opens as its own top-level window; OmniTerm does not currently dock an external window into a
pane. If that is built, it will be a **generic** primitive (reparent any pid's window into a pane rect),
not an RDP-specific host command — see the note at the top of `src-tauri/src/rdp_embed.rs`.

---

## Testing and debugging

`pnpm run:plugin <dir>` loads your plugin in the **real** sidecar and prints what the app would see —
without building or launching the app:

```
$ pnpm run:plugin ./my-plugin
  [plugin log] my-plugin activated

✓ @acme/my-plugin@0.1.0  [bundled]  status: loaded
    permissions: connections, renderer
    registered:  connections, invoke

plugin.available: true
```

The directory is loaded *in addition to* whatever is installed, so nothing is copied anywhere and you can
check a plugin before installing it. Exit status is non-zero if any plugin would not load, so it works in
a pre-commit hook or CI. Add `--invoke <method> '[args]'` to call your `registerInvokeHandler` surface:

```bash
pnpm run:plugin ./my-plugin --invoke listTree
pnpm run:plugin ./my-plugin --invoke setCredential '["conn-1",{"mode":"none"}]'
```

Reverse calls are answered exactly as the host answers them — `credentials.*` is **refused**, so a plugin
depending on host storage fails here for the same reason it would fail in the app. `openExternal` is
printed rather than performed: a plugin under test should not be able to open a browser tab.

You can also drive the sidecar by hand; it is line-delimited JSON-RPC on stdio:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"plugin.list","params":{}}' \
  | node src-tauri/sidecar/plugin-host.cjs "$APPDATA/com.omniterm.app"
```

The response lists every discovered plugin with its `status`, `permissions`, and `error` — the same data
the Plugins panel renders. `status: "loaded"` with your providers marked active means it worked.

The `appDataDir` argument must be **absolute**, and on Windows it must not carry the `\\?\` verbatim
prefix. Node reads `\\?\` as the whole path root and then `lstat`s the drive letter, so
`node \\?\D:\…\plugin-host.cjs` dies with `EISDIR: lstat 'D:'` before running a line of the sidecar —
which is why the host normalizes every path it hands to Node (`node_arg_path` in `plugin_host_api.rs`).

The sidecar writes diagnostics to stderr, which the host inherits, so `pnpm tauri:dev` shows them in the
terminal. `host.services.log(msg)` reaches the host log in dev builds (release builds keep no log).

The Full provider in [`plugins/full-connection-manager`](../plugins/full-connection-manager) demonstrates
Windows Credential Manager-backed metadata. The Limited Connections provider in
[`plugins/native-batch-connections`](../plugins/native-batch-connections) demonstrates a
`prompt-every-time` provider with generated, credential-free launchers.
