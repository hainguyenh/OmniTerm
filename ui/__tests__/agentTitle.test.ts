import { describe, expect, it } from 'vitest'
import { extractFolder, formatTerminalTitle, parseAgentTitle } from '../utils/agentTitle'

describe('parseAgentTitle', () => {
  it('returns null for empty or ordinary shell titles', () => {
    expect(parseAgentTitle('')).toBeNull()
    expect(parseAgentTitle('bash')).toBeNull()
    expect(parseAgentTitle('~/projects/my-app')).toBeNull()
    expect(parseAgentTitle('user@host: ~/work')).toBeNull()
    expect(parseAgentTitle('vim README.md')).toBeNull()
    expect(parseAgentTitle('npm run dev')).toBeNull()
  })

  describe('Claude Code', () => {
    it('detects "claude" prefix with path', () => {
      const result = parseAgentTitle('claude: ~/my-project')
      expect(result?.agentName).toBe('Claude Code')
      expect(result?.folderName).toBe('my-project')
    })

    it('detects "claude code" with absolute path', () => {
      const result = parseAgentTitle('claude code /home/user/repo')
      expect(result?.agentName).toBe('Claude Code')
      expect(result?.folderName).toBe('repo')
    })

    it('handles Windows-style paths', () => {
      const result = parseAgentTitle('claude: C:\\Users\\me\\my-repo')
      expect(result?.agentName).toBe('Claude Code')
      expect(result?.folderName).toBe('my-repo')
    })

    it('returns folderName null when no path present', () => {
      const result = parseAgentTitle('claude')
      expect(result?.agentName).toBe('Claude Code')
      expect(result?.folderName).toBeNull()
    })
  })

  describe('Aider', () => {
    it('detects aider with path', () => {
      const result = parseAgentTitle('aider /home/user/my-feature')
      expect(result?.agentName).toBe('Aider')
      expect(result?.folderName).toBe('my-feature')
    })

    it('detects aider in mixed-case title', () => {
      const result = parseAgentTitle('Aider — ~/work/oss-lib')
      expect(result?.agentName).toBe('Aider')
      expect(result?.folderName).toBe('oss-lib')
    })
  })

  describe('Cursor Agent', () => {
    it('prefers "cursor agent" over bare "cursor"', () => {
      const result = parseAgentTitle('cursor agent: /srv/app')
      expect(result?.agentName).toBe('Cursor Agent')
      expect(result?.folderName).toBe('app')
    })

    it('detects bare "cursor"', () => {
      const result = parseAgentTitle('cursor ~/frontend')
      expect(result?.agentName).toBe('Cursor Agent')
      expect(result?.folderName).toBe('frontend')
    })
  })

  describe('other agents', () => {
    it('detects OpenCode', () => {
      expect(parseAgentTitle('opencode: ~/project')?.agentName).toBe('OpenCode')
    })

    it('detects Copilot CLI', () => {
      expect(parseAgentTitle('copilot cli /opt/project')?.agentName).toBe('Copilot CLI')
    })

    it('detects Cline', () => {
      expect(parseAgentTitle('cline: ~/tasks')?.agentName).toBe('Cline')
    })

    it('detects Goose', () => {
      expect(parseAgentTitle('goose')?.agentName).toBe('Goose')
    })

    it('detects Codex', () => {
      expect(parseAgentTitle('codex cli /workspace/app')?.agentName).toBe('Codex')
    })

    it('detects Gemini CLI', () => {
      const result = parseAgentTitle('gemini cli ~/work/demo')
      expect(result?.agentName).toBe('Gemini CLI')
      expect(result?.folderName).toBe('demo')
    })

    it('detects Antigravity CLI', () => {
      expect(parseAgentTitle('antigravity: /some/path')?.agentName).toBe('Antigravity CLI')
    })
  })

  describe('folder extraction edge cases', () => {
    it('extracts the last segment of a deep path', () => {
      const result = parseAgentTitle('aider /very/deep/nested/folder')
      expect(result?.folderName).toBe('folder')
    })

    it('handles paths with trailing slash', () => {
      const result = parseAgentTitle('claude: /home/user/repo/')
      expect(result?.agentName).toBe('Claude Code')
      expect(result?.folderName).toBeTruthy()
    })

    it('returns null folderName for agent name only', () => {
      const result = parseAgentTitle('goose')
      expect(result?.folderName).toBeNull()
    })
  })
})

describe('extractFolder', () => {
  it('filters out system directories and shell binaries', () => {
    expect(extractFolder('C:\\windows\\system32\\cmd.exe')).toBeNull()
    expect(extractFolder('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBeNull()
    expect(extractFolder('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeNull()
    expect(extractFolder('/usr/bin/bash')).toBeNull()
    expect(extractFolder('/bin/sh')).toBeNull()
    expect(extractFolder('powershell.exe')).toBeNull()
    expect(extractFolder('system32')).toBeNull()
  })

  it('extracts directory from standard user and project paths', () => {
    expect(extractFolder('C:\\Program Files\\nodejs')).toBe('nodejs')
    expect(extractFolder('F:\\my-repos\\contributing\\OmniTerm')).toBe('OmniTerm')
    expect(extractFolder('/home/user/workspace/web-app')).toBe('web-app')
  })

  it('handles root or drive root correctly', () => {
    expect(extractFolder('C:\\')).toBe('C:\\')
  })
})

describe('formatTerminalTitle', () => {
  it('formats AI agent sessions with folder and shell', () => {
    const formatted = formatTerminalTitle('claude: ~/my-project', 'PowerShell 7')
    expect(formatted.isAgent).toBe(true)
    expect(formatted.agentName).toBe('Claude Code')
    expect(formatted.folderName).toBe('my-project')
    expect(formatted.displayTitle).toBe('Claude Code - my-project // PowerShell 7')
  })

  it('detects Antigravity and uses fallbackCwd when title has no path', () => {
    const formatted = formatTerminalTitle('Antigravity', 'PowerShell', undefined, 'F:\\my-repos\\contributing\\OmniTerm')
    expect(formatted.isAgent).toBe(true)
    expect(formatted.agentName).toBe('Antigravity CLI')
    expect(formatted.folderName).toBe('OmniTerm')
    expect(formatted.displayTitle).toBe('Antigravity CLI - OmniTerm // PowerShell')
  })

  it('detects Antigravity from agy alias with path', () => {
    const formatted = formatTerminalTitle('agy: ~/OmniTerm', 'PowerShell')
    expect(formatted.isAgent).toBe(true)
    expect(formatted.agentName).toBe('Antigravity CLI')
    expect(formatted.folderName).toBe('OmniTerm')
    expect(formatted.displayTitle).toBe('Antigravity CLI - OmniTerm // PowerShell')
  })

  it('falls back to fallbackCwd when raw title is a system shell executable path', () => {
    const formatted = formatTerminalTitle(
      'C:\\windows\\system32\\cmd.exe',
      'PowerShell',
      'PowerShell',
      'F:\\my-repos\\contributing\\OmniTerm',
    )
    expect(formatted.isAgent).toBe(false)
    expect(formatted.folderName).toBe('OmniTerm')
    expect(formatted.displayTitle).toBe('OmniTerm // PowerShell')
  })

  it('formats plain terminal session with extracted folder and shell', () => {
    const formatted = formatTerminalTitle('F:\\my-repos\\contributing\\OmniTerm', 'cmd')
    expect(formatted.isAgent).toBe(false)
    expect(formatted.folderName).toBe('OmniTerm')
    expect(formatted.displayTitle).toBe('OmniTerm // cmd')
  })

  it('formats directory without path and avoids repeating shell name', () => {
    const formatted = formatTerminalTitle('OmniTerm', 'PowerShell')
    expect(formatted.isAgent).toBe(false)
    expect(formatted.displayTitle).toBe('OmniTerm // PowerShell')

    const same = formatTerminalTitle('PowerShell', 'PowerShell')
    expect(same.displayTitle).toBe('PowerShell')
  })

  it('formats fallback when title is empty', () => {
    const formatted = formatTerminalTitle('', 'bash', 'Local Terminal')
    expect(formatted.displayTitle).toBe('Local Terminal // bash')
  })
})
