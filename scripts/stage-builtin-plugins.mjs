#!/usr/bin/env node
/**
 * Stages the built-in IDE plugins into `src-tauri/builtin-plugins/` (bundled as app resources).
 *
 * Sources and components come from `plugins/` (plugin sources, built with
 * `plugins/build.sh`). Only what the host loads is staged: the manifest, the component
 * and the data files the manifest points at, never Rust sources, lockfiles or build output.
 * Which plugins ship is the `BUILTIN_PLUGINS` and `OPTIONAL_PLUGINS` lists in
 * `src-tauri/src/builtin_plugins.rs`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './is-main.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'plugins', 'official')
const TARGET = path.join(ROOT, 'src-tauri', 'builtin-plugins')
const LIST_FILE = path.join(ROOT, 'src-tauri', 'src', 'builtin_plugins.rs')
const NOT_SHIPPED = new Set(['src', 'target', 'web-src', 'Cargo.toml', 'Cargo.lock', 'example.tests'])

function listedIds(source, name) {
  const list = new RegExp(`${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(source)?.[1]
  if (!list) throw new Error(`${name} not found in builtin_plugins.rs`)
  return [...list.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1])
}

/** Every plugin the bundle ships: the built-in ones and the optional ones kept up to date. */
export function builtinPluginIds(source = readFileSync(LIST_FILE, 'utf8')) {
  return [...listedIds(source, 'BUILTIN_PLUGINS'), ...listedIds(source, 'OPTIONAL_PLUGINS')]
}

/** The files of one plugin directory that belong in the bundle, relative to it. */
export function shippedFiles(dir, relative = '') {
  const out = []
  for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    if (NOT_SHIPPED.has(entry.name) || entry.name.endsWith('.md') || entry.name.endsWith('.sources')) continue
    if (entry.isDirectory()) out.push(...shippedFiles(dir, next))
    else if (entry.isFile()) out.push(next)
  }
  return out
}

export function stage({ ids = builtinPluginIds(), source = SOURCE, target = TARGET } = {}) {
  rmSync(target, { recursive: true, force: true })
  const staged = []
  for (const id of ids) {
    const dir = path.join(source, id)
    if (!existsSync(path.join(dir, 'plugin.toml'))) throw new Error(`no plugin ${id} in ${source}`)
    const manifest = readFileSync(path.join(dir, 'plugin.toml'), 'utf8')
    const wasm = /^wasm\s*=\s*"([^"]+)"/m.exec(manifest)?.[1]
    if (wasm && !existsSync(path.join(dir, wasm))) {
      throw new Error(`${id}: ${wasm} is not built; run plugins/build.sh official/${id}`)
    }
    for (const file of shippedFiles(dir)) {
      mkdirSync(path.dirname(path.join(target, id, file)), { recursive: true })
      cpSync(path.join(dir, file), path.join(target, id, file))
    }
    staged.push(id)
  }
  return staged
}

if (isMain(import.meta.url)) {
  const ids = stage()
  const size = (dir) => readdirSync(dir, { recursive: true }).reduce((sum, f) => {
    const full = path.join(dir, f)
    return sum + (statSync(full).isFile() ? statSync(full).size : 0)
  }, 0)
  console.log(`staged ${ids.length} plugins (${Math.round(size(TARGET) / 1024)} KB)`)
}
