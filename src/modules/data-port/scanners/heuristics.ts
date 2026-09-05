// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateKind, CandidateTarget, SourceProfile } from '../types.js'

export interface HeuristicHint {
  kind: CandidateKind
  target: CandidateTarget
  confidence: number
  reason: string
  selectedByDefault: boolean
}

const NOISE: HeuristicHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.9,
  reason: 'Likely noise (logs, lockfiles, binary, secrets)',
  selectedByDefault: false,
}

const INDEX_SKIP: HeuristicHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.95,
  reason: 'One-line memory index (e.g. MEMORY.md) — skip so it does not flood the vault',
  selectedByDefault: false,
}

const JUNK_SKIP: HeuristicHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.9,
  reason: 'Third-party source, product docs, or boilerplate — not durable EYAS memory',
  selectedByDefault: false,
}

const JUNK_BASE = new Set([
  'robots.txt',
  'license',
  'license.md',
  'licence',
  'licence.md',
  'copying',
  'changelog',
  'changelog.md',
  'contributing',
  'contributing.md',
  'code_of_conduct.md',
  'security.md',
  'authors',
  'notice',
  'makefile',
  'dockerfile',
  'package.json',
  'tsconfig.json',
  'cargo.toml',
  'go.mod',
  'gemfile',
])

function posix(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').toLowerCase()
}

/** Assistant / vault trees the importer is allowed to treat as memory. */
export function isDurableMemoryPath(relativePath: string): boolean {
  const p = posix(relativePath)
  return (
    p.includes('ai-memory/') ||
    p.includes('.grok/memory/') ||
    p.includes('/.claude/memory/') ||
    p.startsWith('.claude/memory/') ||
    p.includes('99_meta/ai-memory') ||
    p.includes('/vault/semantic/') ||
    p.includes('/vault/procedural/') ||
    p.includes('/vault/projects/') ||
    p.includes('/vault/project-types/') ||
    p.startsWith('vault/semantic/') ||
    p.startsWith('vault/procedural/')
  )
}

export function isAssistantSkillPath(relativePath: string): boolean {
  const p = posix(relativePath)
  return (
    p.startsWith('skills/') ||
    p.startsWith('.claude/skills/') ||
    p.startsWith('.agents/skills/') ||
    p.startsWith('.grok/skills/') ||
    p.includes('/.claude/skills/') ||
    p.includes('/.agents/skills/') ||
    p.includes('/.grok/skills/')
  )
}

export function isAssistantWorkspacePath(relativePath: string): boolean {
  const p = posix(relativePath)
  if (!p.includes('/')) return true
  return (
    p.startsWith('.claude/') ||
    p.startsWith('.cursor/') ||
    p.startsWith('.grok/') ||
    p.startsWith('.agents/') ||
    p.includes('/.claude/') ||
    p.includes('/.cursor/') ||
    p.includes('/.grok/') ||
    p.includes('/.agents/') ||
    p.includes('/data/agents/')
  )
}

/** One-line MEMORY.md / wiki index — never copy as a single vault note. */
export function isMemoryIndexFile(relativePath: string, content: string): boolean {
  const p = posix(relativePath)
  const base = p.split('/').pop() ?? p
  if (base === 'memory.md') return true

  const stripped = content.replace(/^---[\s\S]*?---\s*/m, '').trim()
  const lines = stripped.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 4) return false
  const bullets = lines.filter(
    (l) => /^[-*+]\s/.test(l) || /^\[[^\]]+\]:/.test(l) || /^\[\[/.test(l) || /^- \[\[[^\]]+\]\]/.test(l),
  )
  const prose = lines.filter((l) => l.length > 80 && !l.startsWith('#') && !l.startsWith('-'))
  return bullets.length / lines.length >= 0.6 && prose.length <= 1 && stripped.length < 8000
}

/** Full TUI/chat session transcripts — not durable notes. */
export function isSessionDumpPath(relativePath: string): boolean {
  const p = posix(relativePath)
  return (
    p.includes('claude-sessions/') ||
    p.includes('99_meta/claude-sessions') ||
    /type:\s*(claude-session|grok-session)\b/i.test(relativePath)
  )
}

export function isImportJunk(relativePath: string, content: string): boolean {
  const p = posix(relativePath)
  const base = p.split('/').pop() ?? p
  if (JUNK_BASE.has(base)) return true
  if (base.startsWith('readme') && !isDurableMemoryPath(p)) return true
  if (p.includes('/docs/user-guide/') || p.includes('.grok/docs/')) return true
  if (base === 'robots.txt' || /robotstxt\.org/i.test(content.slice(0, 400))) return true
  if (isSessionDumpPath(relativePath)) return true
  if (/^---[\s\S]*type:\s*(claude-session|grok-session)\b/i.test(content.slice(0, 500))) return true
  return false
}

export function detectProfileFromPaths(paths: string[]): SourceProfile {
  const lower = paths.map((p) => p.toLowerCase().replace(/\\/g, '/'))
  if (lower.some((p) => p.includes('manifest.json') && lower.some((q) => q.startsWith('vault/') || q.includes('/vault/')))) {
    return 'eyas-export'
  }
  if (
    lower.some(
      (p) =>
        p === 'claude.md' ||
        p.startsWith('.claude/') ||
        p.includes('/.claude/'),
    )
  ) {
    return 'claude-code'
  }
  if (lower.some((p) => p.includes('.cursor/') || p.startsWith('.cursor/') || p === '.cursorrules' || p.includes('cursor/rules'))) {
    return 'cursor'
  }
  if (lower.some((p) => p.includes('.obsidian/'))) return 'obsidian'
  if (lower.some((p) => p.includes('conversations.json') || p.includes('chat.html') || p.endsWith('.jsonl'))) {
    return 'chat-export'
  }
  return 'generic-md'
}

export function classifyPath(
  relativePath: string,
  content: string,
  profile?: SourceProfile,
): HeuristicHint {
  const p = posix(relativePath)
  const base = p.split('/').pop() ?? p

  if (isMemoryIndexFile(relativePath, content)) return INDEX_SKIP
  if (isImportJunk(relativePath, content)) return JUNK_SKIP

  // Hard skip noise — binaries, keys, logs, spreadsheets, lockfiles, etc.
  if (
    base.endsWith('.lock') ||
    base.endsWith('.png') ||
    base.endsWith('.jpg') ||
    base.endsWith('.jpeg') ||
    base.endsWith('.gif') ||
    base.endsWith('.webp') ||
    base.endsWith('.pdf') ||
    base.endsWith('.zip') ||
    base.endsWith('.sqlite') ||
    base.endsWith('.db') ||
    base.endsWith('.log') ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base.endsWith('.p12') ||
    base.endsWith('.pfx') ||
    base.endsWith('.crt') ||
    base.endsWith('.cer') ||
    base.endsWith('.csv') ||
    base.endsWith('.tsv') ||
    base.endsWith('.xls') ||
    base.endsWith('.xlsx') ||
    base.endsWith('.bin') ||
    base.endsWith('.exe') ||
    base.endsWith('.dll') ||
    base.endsWith('.so') ||
    base.endsWith('.dylib') ||
    base.endsWith('.o') ||
    base.endsWith('.class') ||
    base.endsWith('.wasm') ||
    base.endsWith('.map') ||
    base.endsWith('.min.js') ||
    base.endsWith('.min.css') ||
    base === 'package-lock.json' ||
    base === 'bun.lock' ||
    base === 'yarn.lock' ||
    p.includes('node_modules/') ||
    p.includes('.git/')
  ) {
    return NOISE
  }

  // Secrets heuristics — only hard indicators (not the words "secret"/"password" in prose)
  if (
    base.includes('.env') ||
    base === 'credentials.json' ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/i.test(content) ||
    /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{20,})\b/.test(content) ||
    /^\s*[A-Z0-9_]*(API[_-]?KEY|SECRET|PASSWORD|TOKEN)\s*=\s*['\"]?[^'\"\s]{12,}/im.test(content.slice(0, 2000))
  ) {
    return {
      kind: 'noise',
      target: 'none',
      confidence: 0.95,
      reason: 'Possible secrets — skipped for safety',
      selectedByDefault: false,
    }
  }

  // Workspace / rules — only assistant dirs or the scan root, never every repo's AGENTS.md
  if (base === 'claude.md' || base === 'agents.md' || base === '.cursorrules' || p.includes('/rules/')) {
    if (!isAssistantWorkspacePath(relativePath)) return JUNK_SKIP
    return {
      kind: 'rule',
      target: 'workspace.agents',
      confidence: 0.88,
      reason: 'Project/agent rules file',
      selectedByDefault: true,
    }
  }
  if (base === 'soul.md' || base === 'soul.style.json') {
    if (!isAssistantWorkspacePath(relativePath)) return JUNK_SKIP
    return {
      kind: 'identity',
      target: 'workspace.soul',
      confidence: 0.9,
      reason: 'Agent soul / persona',
      selectedByDefault: true,
    }
  }
  if (base === 'identity.md') {
    if (!isAssistantWorkspacePath(relativePath)) return JUNK_SKIP
    return {
      kind: 'identity',
      target: 'workspace.identity',
      confidence: 0.9,
      reason: 'Agent identity',
      selectedByDefault: true,
    }
  }
  if (base === 'tools.md') {
    if (!isAssistantWorkspacePath(relativePath)) return JUNK_SKIP
    return {
      kind: 'rule',
      target: 'workspace.tools',
      confidence: 0.85,
      reason: 'Tools policy',
      selectedByDefault: true,
    }
  }

  // Skills — assistant skill trees only. A product checkout's config/skills is not an import.
  const inSkillsTree =
    base === 'skill.md' ||
    p.endsWith('/skill.md') ||
    isAssistantSkillPath(relativePath)

  if (inSkillsTree) {
    return {
      kind: 'skill',
      target: 'skill',
      confidence: 0.92,
      reason: 'Skill / procedure document',
      selectedByDefault: true,
    }
  }

  // Vault memory notes with name/description frontmatter (Claude memory format)
  if (
    /^---[\s\S]*\b(type|metadata|node_type):\s/i.test(content.slice(0, 600)) ||
    /^---[\s\S]*\bname:\s/i.test(content.slice(0, 400)) &&
      /^---[\s\S]*\bdescription:\s/i.test(content.slice(0, 600))
  ) {
    // Fall through to memory classification below with a strong hint
  }

  // Memory — only known assistant/vault trees, never every file whose path contains "memory"
  const looksLikeVaultNote =
    /type:\s*(claude-session|grok-session|session|feedback|project|reference|user|domain)/i.test(content.slice(0, 500)) ||
    /node_type:\s*memory/i.test(content.slice(0, 500)) ||
    (/^---[\s\S]*\bname:\s/i.test(content.slice(0, 400)) &&
      /^---[\s\S]*\bdescription:\s/i.test(content.slice(0, 600)))

  if (isDurableMemoryPath(relativePath)) {
    const episodic = /type:\s*(claude-session|grok-session|session)/i.test(content.slice(0, 500))
    return {
      kind: 'memory',
      target: episodic ? 'episodic' : 'vault.semantic',
      confidence: 0.8,
      reason: episodic ? 'Session/memory with temporal cues' : 'Long-lived memory note',
      selectedByDefault: true,
    }
  }

  if (looksLikeVaultNote) return JUNK_SKIP

  // Obsidian / vault-like
  if (p.includes('/semantic/') || /^---[\s\S]*tier:\s*semantic/i.test(content.slice(0, 400))) {
    return {
      kind: 'memory',
      target: 'vault.semantic',
      confidence: 0.9,
      reason: 'Semantic vault note',
      selectedByDefault: true,
    }
  }
  if (p.includes('/procedural/') || /^---[\s\S]*tier:\s*procedural/i.test(content.slice(0, 400))) {
    return {
      kind: 'memory',
      target: 'vault.procedural',
      confidence: 0.9,
      reason: 'Procedural vault note',
      selectedByDefault: true,
    }
  }

  // How-to / generic markdown: only when this *is* an Obsidian vault scan.
  // A home directory or git checkout matching "how to" must not flood the vault.
  const isNoteExt = base.endsWith('.md') || base.endsWith('.markdown') || base.endsWith('.txt')
  if (isNoteExt && profile === 'obsidian') {
    const procedural = /\b(how to|howto|runbook|checklist|procedure|lépés|útmutató)\b/i.test(content.slice(0, 500))
    return {
      kind: 'memory',
      target: procedural ? 'vault.procedural' : 'vault.semantic',
      confidence: 0.7,
      reason: procedural ? 'How-to / runbook style content' : 'Obsidian note',
      selectedByDefault: content.trim().length > 80,
    }
  }
  if (isNoteExt) return JUNK_SKIP

  // Chat export JSON — import as memory candidates only if small enough
  if (base.endsWith('.json') || base.endsWith('.jsonl')) {
    return {
      kind: 'memory',
      target: 'episodic',
      confidence: 0.45,
      reason: 'Structured export — may need AI extraction',
      selectedByDefault: false,
    }
  }

  return {
    kind: 'unknown',
    target: 'none',
    confidence: 0.2,
    reason: 'Unrecognized file type',
    selectedByDefault: false,
  }
}

export function titleFromPathAndContent(relativePath: string, content: string): string {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath
  const withoutExt = base.replace(/\.(md|markdown|txt|json|jsonl)$/i, '')
  const fmTitle = content.match(/^---[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (fmTitle?.[1]) return fmTitle[1].trim()
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1?.[1]) return h1[1].trim().slice(0, 120)
  return withoutExt.replace(/[-_]/g, ' ').trim() || base
}

export function previewOf(content: string, max = 280): string {
  const stripped = content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= max) return stripped
  return `${stripped.slice(0, max - 1)}…`
}
