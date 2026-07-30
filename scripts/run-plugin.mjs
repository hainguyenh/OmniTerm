#!/usr/bin/env node
/**
 * pnpm run:plugin [dir] [--invoke <method> [jsonArgs]]
 *
 * Run the real plugin host sidecar against a plugin and print what OmniTerm would see, without
 * launching the app.
 *
 * This exists because the app is the slowest possible way to answer "did my plugin load?". The sidecar
 * is a plain Node process speaking JSON-RPC on stdio, so it can be driven directly — and its answer to
 * `plugin.list` is byte-for-byte what the Plugins panel renders. A `status` other than `loaded` here is
 * the same failure you would have seen in the app, minus the build and the restart.
 *
 * Passing a directory loads it *in addition to* whatever is installed, so a plugin can be checked
 * before `pnpm install:plugin` puts it anywhere permanent. Nothing is copied and nothing is installed.
 *
 * Reverse calls are answered exactly as src-tauri/src/plugin_host_api.rs answers them — in particular
 * `credentials.*` is refused, so a plugin that depends on host storage fails here for the same reason it
 * would fail in the app. `openExternal` is reported rather than performed: this is a test harness, and a
 * plugin under test should not be able to open a browser tab.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { root, pluginsDir, readManifest, die } from './plugin-paths.mjs'

const SIDECAR = path.join(root, 'src-tauri', 'sidecar', 'plugin-host.cjs')
const TIMEOUT_MS = 15000

function parseArgs(argv) {
  const out = { dir: null, invoke: null, args: [] }
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--invoke') {
      out.invoke = argv[i + 1]
      if (!out.invoke) die('--invoke needs a method name.')
      // Optional JSON array of arguments, e.g. --invoke setCredential '["id",{"mode":"none"}]'
      const maybeJson = argv[i + 2]
      if (maybeJson !== undefined && !maybeJson.startsWith('--')) {
        try {
          const parsed = JSON.parse(maybeJson)
          out.args = Array.isArray(parsed) ? parsed : [parsed]
        } catch (err) {
          die(`--invoke arguments must be JSON: ${err.message}`)
        }
        i += 1
      }
      i += 1
      continue
    }
    rest.push(argv[i])
  }
  if (rest.length > 1) die(`Unexpected arguments: ${rest.slice(1).join(' ')}`)
  out.dir = rest[0] ? path.resolve(rest[0]) : null
  return out
}

/**
 * Mirror of `handle_reverse_call` in src-tauri/src/plugin_host_api.rs.
 *
 * Kept deliberately identical in what it *refuses*. A harness that were more permissive than the host
 * would certify a plugin that then failed in the app, which is worse than having no harness.
 */
function answerReverseCall(method, params) {
  switch (method) {
    case 'credentials.get':
    case 'credentials.set':
    case 'credentials.delete':
      return { error: 'OmniTerm provides no credential storage; a plugin must supply its own' }
    case 'host.log':
      console.log(`  [plugin log] ${params?.message ?? ''}`)
      return { result: true }
    case 'host.openExternal':
      console.log(`  [openExternal] ${params?.url ?? '(no url)'}  (not opened — harness)`)
      return { result: true }
    default:
      return { error: `unknown host method "${method}"` }
  }
}

/** Line-delimited JSON-RPC client over a child's stdio, with the reverse-call half wired up. */
function connect(child) {
  const pending = new Map()
  let nextId = 1
  let buffer = ''

  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`)

  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (!line) continue

      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      // A reply to one of ours.
      const waiter = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
      if (waiter) {
        pending.delete(msg.id)
        if (msg.error) waiter.reject(new Error(msg.error.message || 'RPC error'))
        else waiter.resolve(msg.result)
        continue
      }

      // A reverse call. No `id` means a notification: dispatch it and answer nothing.
      if (!msg.method) continue
      const outcome = answerReverseCall(msg.method, msg.params)
      if (msg.id === undefined) continue
      send(
        outcome.error
          ? { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: outcome.error } }
          : { jsonrpc: '2.0', id: msg.id, result: outcome.result },
      )
    }
  })

  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })
}

const GLYPH = { loaded: '✓', error: '✗', incompatible: '✗', disabled: '·' }

function printDescriptor(d) {
  const glyph = GLYPH[d.status] ?? '?'
  console.log(`\n${glyph} ${d.id}@${d.version}  [${d.source}]  status: ${d.status}`)
  console.log(`    permissions: ${d.permissions?.length ? d.permissions.join(', ') : '(none)'}`)

  const providers = [
    d.activeConnectionProvider && 'connections',
    d.activeAuthProvider && 'auth',
    d.activeInvokeHandler && 'invoke',
  ].filter(Boolean)
  console.log(`    registered:  ${providers.length ? providers.join(', ') : '(nothing)'}`)
  if (d.error) console.log(`    error:       ${d.error}`)

  // Declaring a permission and never using it is the common scaffolding mistake, and the install
  // script asks the user to approve each one — so it is worth naming here rather than at install time.
  if (d.status === 'loaded' && d.permissions?.includes('connections') && !d.activeConnectionProvider) {
    console.log('    note:        declares "connections" but registered no connection provider.')
  }
}

async function main() {
  const { dir, invoke, args } = parseArgs(process.argv.slice(2))
  if (!existsSync(SIDECAR)) die(`Plugin host not found at ${SIDECAR}`)

  const appDataDir = path.dirname(pluginsDir())
  const spawnArgs = [SIDECAR, appDataDir]

  if (dir) {
    // Fail on a manifest the host would reject before spending a process on it, and report the same
    // reason `install:plugin` would.
    let manifest
    try {
      manifest = readManifest(dir)
    } catch (err) {
      die(err.message)
    }
    const main_ = path.resolve(dir, manifest.main)
    if (!existsSync(main_)) {
      die(`${manifest.pkg.name} has no built entry point at ${main_}. Run: pnpm build:plugin ${dir}`)
    }
    spawnArgs.push(dir)
    console.log(`Loading ${manifest.pkg.name} from ${dir}`)
  }

  console.log(`App data:      ${appDataDir}`)
  console.log(`Installed in:  ${pluginsDir()}`)

  const child = spawn(process.execPath, spawnArgs, { stdio: ['pipe', 'pipe', 'inherit'] })
  child.on('error', (err) => die(`Could not start the plugin host: ${err.message}`))

  const call = connect(child)
  const timer = setTimeout(() => {
    child.kill()
    die(`The plugin host did not answer within ${TIMEOUT_MS / 1000}s.`)
  }, TIMEOUT_MS)

  let failed = false
  try {
    const descriptors = await call('plugin.list')
    if (!descriptors.length) {
      console.log('\nNo plugins discovered. Nothing is installed, and no directory was passed.')
    }
    for (const d of descriptors) {
      printDescriptor(d)
      if (d.status !== 'loaded') failed = true
    }

    const available = await call('plugin.available')
    console.log(`\nplugin.available: ${available}`)

    if (invoke) {
      console.log(`\nplugin.invoke(${invoke}${args.length ? `, ${JSON.stringify(args)}` : ''}):`)
      try {
        console.log(JSON.stringify(await call('plugin.invoke', { method: invoke, args }), null, 2))
      } catch (err) {
        // An invoke failure is the plugin's answer, not a harness failure — report and keep the
        // descriptor verdict as the exit code.
        console.log(`  ✗ ${err.message}`)
        failed = true
      }
    }
  } finally {
    clearTimeout(timer)
    child.stdin.end()
    child.kill()
  }

  if (failed) {
    console.error('\n✗ Something would not work in the app. See the statuses above.')
    process.exit(1)
  }
  console.log('\n✓ The app would load this exactly as shown.')
}

await main()
