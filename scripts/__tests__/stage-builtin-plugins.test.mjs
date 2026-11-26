import assert from 'node:assert/strict'
import test from 'node:test'

import { builtinPluginIds } from '../stage-builtin-plugins.mjs'

test('the bundle ships the built-in and the optional plugins', () => {
  const source = [
    'pub(crate) const BUILTIN_PLUGINS: &[&str] = &[\n    "todo-finder",\n    "csv-editor",\n];',
    'pub(crate) const OPTIONAL_PLUGINS: &[&str] = &["git-toolbox", "solidity"];',
  ].join('\n')
  assert.deepEqual(builtinPluginIds(source), ['todo-finder', 'csv-editor', 'git-toolbox', 'solidity'])
})

test('a missing list is an error, not an empty bundle', () => {
  assert.throws(() => builtinPluginIds('pub(crate) const BUILTIN_PLUGINS: &[&str] = &["a"];'), /OPTIONAL_PLUGINS/)
})
