/**
 * Sandboxed Temporary Workspace Fixture Generator for OmniTerm E2E tests.
 * Manages isolated directory sandboxes, file creation, and automatic cleanup.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const activeWorkspaces = new Set()

export async function createTempWorkspace(prefix = 'omniterm-e2e-') {
  const baseDir = os.tmpdir()
  const workspaceRoot = await mkdtemp(path.join(baseDir, prefix))

  const workspace = {
    root: workspaceRoot,

    resolve(relPath) {
      return path.resolve(workspaceRoot, relPath)
    },

    async writeFile(relPath, content = '') {
      const fullPath = this.resolve(relPath)
      const parentDir = path.dirname(fullPath)
      await mkdir(parentDir, { recursive: true })
      await writeFile(fullPath, content, typeof content === 'string' ? 'utf8' : undefined)
      return fullPath
    },

    async readFile(relPath, encoding = 'utf8') {
      const fullPath = this.resolve(relPath)
      return readFile(fullPath, encoding)
    },

    async mkdir(relPath) {
      const fullPath = this.resolve(relPath)
      await mkdir(fullPath, { recursive: true })
      return fullPath
    },

    exists(relPath) {
      return existsSync(this.resolve(relPath))
    },

    async cleanup() {
      try {
        if (existsSync(workspaceRoot)) {
          await rm(workspaceRoot, { recursive: true, force: true })
        }
      } catch (err) {
        console.warn(`Failed to cleanup temp workspace ${workspaceRoot}:`, err)
      } finally {
        activeWorkspaces.delete(workspace)
      }
    },
  }

  activeWorkspaces.add(workspace)
  return workspace
}

export async function cleanupAllWorkspaces() {
  const list = Array.from(activeWorkspaces)
  for (const ws of list) {
    await ws.cleanup()
  }
}

// Ensure cleanup on process exit
process.on('exit', () => {
  for (const ws of activeWorkspaces) {
    try {
      if (existsSync(ws.root)) {
        import('node:fs').then((fs) => fs.rmSync(ws.root, { recursive: true, force: true }))
      }
    } catch {
      // Ignore exit cleanup errors
    }
  }
})
