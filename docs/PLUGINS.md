# Writing an OmniTerm plugin

OmniTerm plugins are CommonJS Node packages loaded by a sidecar process. They may provide saved
connection metadata, workspace data, an app-open authentication gate, renderer extensions, or safe
host services declared through permissions.

```bash
pnpm create:plugin my-plugin
pnpm build:plugin ./my-plugin
pnpm run:plugin ./my-plugin
pnpm install:plugin ./my-plugin
```

## Password rule

The host and bundled plugins do not store passwords.

- `Connection` contains metadata only and has no password/secret field.
- The only connection credential policy is `prompt-every-time`.
- There is no credential service, credential permission, save-password command, or credential RPC.
- SSH authentication is typed directly into `ssh.exe` through the terminal.
- RDP authentication is handled by the native Remote Desktop client.
- Generated `.rdp` files contain host, port, username, and non-secret options only.
- `passwordHelpUrl` may contain an HTTPS help-page URL; it never contains the password itself.

Do not add password values to plugin storage or invoke results. Invoke results are returned to the
webview and therefore must be safe to render.

## Runtime and trust

A plugin runs as the current user in a Node.js sidecar and is **not sandboxed**. It can use Node APIs
such as `fs`, `net`, and `child_process`. Install only trusted plugins. Permission declarations gate
OmniTerm host APIs, but they cannot restrict arbitrary Node code.

Plugins are discovered under the app's plugin directory:

```text
Windows  %APPDATA%\com.omniterm.app\plugins\
macOS    ~/Library/Application Support/com.omniterm.app/plugins/
Linux    ${XDG_CONFIG_HOME:-~/.config}/com.omniterm.app/plugins/
```

## Manifest

```json
{
  "name": "example-plugin",
  "version": "0.1.0",
  "type": "commonjs",
  "main": "dist/index.js",
  "omnitermPlugin": {
    "apiVersion": 2,
    "hostVersion": ">=0.1.0 <1.0.0",
    "displayName": "Example Plugin",
    "permissions": ["connections", "openExternal"]
  }
}
```

Supported permissions:

| Permission | Host capability |
|---|---|
| `connections` | Register a connection provider |
| `auth` | Register an app-open authentication provider |
| `renderer` | Register renderer-facing plugin behavior |
| `openExternal` | Open validated HTTPS URLs |
| `clipboard` | Write text to the clipboard |
| `workspace` | Provide or use workspace-scoped behavior |

There is deliberately no `credentials` permission.

## Minimal connection provider

```ts
import type { HostAPI, PluginModule } from '@omniterm/contract'

export async function activate(host: HostAPI): Promise<void> {
  host.registerConnectionProvider({
    capabilities: () => ({
      protocols: ['SSH', 'RDP'],
      credentialPolicy: 'prompt-every-time',
      scopes: ['personal'],
      sftp: false,
      importExport: true,
    }),
    load: () => ({ folders: [], connections: [] }),
    save: async (tree) => {
      // Persist metadata only. Never add password or secret fields.
      host.services.log(`saved ${tree.connections.length} profiles`)
    },
    resolve: async () => null,
  })
}

const plugin: PluginModule = { name: 'example-plugin', activate }
export default plugin
```

`resolve` and `resolveScoped` return metadata-only `Connection` values. The host starts the native
transport, which asks the user to authenticate.

## Host services

```ts
interface HostServices {
  storageDir: string
  log(message: string): void
  openExternal(url: string): Promise<void>
  writeClipboard(text: string): Promise<void>
}
```

- `storageDir` is for plugin configuration and metadata, not credentials.
- `openExternal` accepts HTTPS URLs without embedded username/password components.
- `writeClipboard` requires the `clipboard` permission.
- Release builds suppress plugin logs; never log sensitive user input regardless.

## Connection metadata

A connection may contain:

```ts
{
  id: string
  name: string
  type: 'SSH' | 'RDP' | 'LOCAL'
  host: string
  port: string
  user: string
  passwordHelpUrl?: string
  parentId?: string
  redirectDrives?: boolean
  shell?: string
  localArgs?: string
  localCwd?: string
  localCommand?: string
  localKeepOpen?: boolean
}
```

`passwordHelpUrl`, when used, must be a plain HTTPS URL to documentation or a user-managed sign-in
page. Embedded URL credentials are rejected.

## Testing and debugging

```bash
pnpm build:plugin ./my-plugin
pnpm run:plugin ./my-plugin
pnpm test:security
```

The security guard fails if shipped source reintroduces known password persistence entry points. Add
plugin-level tests that serialize stored metadata and assert password-shaped input fields are removed.

The complete API is defined by [`../contract/index.ts`](../contract/index.ts).
