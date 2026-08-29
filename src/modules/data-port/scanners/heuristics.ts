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

export function detectProfileFromPaths(paths: string[]): SourceProfile {
  const lower = paths.map((p) => p.toLowerCase().replace(/\\/g, '/'))
  if (lower.some((p) => p.includes('manifest.json') && lower.some((q) => q.startsWith('vault/') || q.includes('/vault/')))) {
    return 'eyas-export'
  }
  if (lower.some((p) => p.endsWith('claude.md') || p.includes('/.claude/') || p.includes('skills/'))) {
    if (lower.some((p) => p.includes('claude'))) return 'claude-code'
  }
  if (lower.some((p) => p.includes('.cursor/') || p.endsWith('.cursorrules') || p.includes('cursor/rules'))) {
    return 'cursor'
  }
  if (lower.some((p) => p.includes('.obsidian/'))) return 'obsidian'
  if (lower.some((p) => p.includes('conversations.json') || p.includes('chat.html') || p.endsWith('.jsonl'))) {
    return 'chat-export'
  }
  if (lower.some((p) => p.endsWith('claude.md'))) return 'claude-code'
  return 'generic-md'
}

export function classifyPath(relativePath: string, content: string): HeuristicHint {
  const p = relativePath.replace(/\\/g, '/').toLowerCase()
  const base = p.split('/').pop() ?? p

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

  // Workspace / rules
  if (base === 'claude.md' || base === 'agents.md' || base === '.cursorrules' || p.includes('/rules/')) {
    return {
      kind: 'rule',
      target: 'workspace.agents',
      confidence: 0.88,
      reason: 'Project/agent rules file',
      selectedByDefault: true,
    }
  }
  if (base === 'soul.md' || base === 'soul.style.json') {
    return {
      kind: 'identity',
      target: 'workspace.soul',
      confidence: 0.9,
      reason: 'Agent soul / persona',
      selectedByDefault: true,
    }
  }
  if (base === 'identity.md') {
    return {
      kind: 'identity',
      target: 'workspace.identity',
      confidence: 0.9,
      reason: 'Agent identity',
      selectedByDefault: true,
    }
  }
  if (base === 'tools.md') {
    return {
      kind: 'rule',
      target: 'workspace.tools',
      confidence: 0.85,
      reason: 'Tools policy',
      selectedByDefault: true,
    }
  }

  // Skills — path-first (SKILL.md / skills/), never treat vault memory notes as skills
  // just because frontmatter has name/description and the word "trigger".
  const inSkillsTree =
    base === 'skill.md' ||
    p.endsWith('/skill.md') ||
    p.includes('/skills/') ||
    p.includes('/.claude/skills/') ||
    p.includes('/.agents/skills/') ||
    p.includes('/.grok/skills/')
  const hasSkillFrontmatter =
    /^---[\s\S]*trigger_patterns\s*:/i.test(content.slice(0, 1200)) ||
    (/^---[\s\S]*\bname:\s/i.test(content.slice(0, 400)) &&
      /^---[\s\S]*\b(description|trigger_patterns):\s/i.test(content.slice(0, 800)) &&
      inSkillsTree)

  if (inSkillsTree || hasSkillFrontmatter) {
    return {
      kind: 'skill',
      target: 'skill',
      confidence: inSkillsTree ? 0.92 : 0.8,
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

  // Memory (Obsidian ai-memory, claude-sessions, agent MEMORY.md, Grok mirror)
  if (
    base === 'memory.md' ||
    p.includes('/memory/') ||
    p.includes('/sessions/') ||
    p.includes('ai-memory/') ||
    p.includes('claude-sessions/') ||
    p.includes('/.grok/memory/') ||
    p.includes('99_meta/ai-memory') ||
    p.includes('99_meta/claude-sessions') ||
    /type:\s*(claude-session|grok-session|session|feedback|project|reference)/i.test(content.slice(0, 500)) ||
    /node_type:\s*memory/i.test(content.slice(0, 500)) ||
    (/^---[\s\S]*\bname:\s/i.test(content.slice(0, 400)) &&
      /^---[\s\S]*\bdescription:\s/i.test(content.slice(0, 600)))
  ) {
    const episodic = /\b(20\d{2}-\d{2}-\d{2}|session|conversation|today|yesterday)\b/i.test(content)
    return {
      kind: 'memory',
      target: episodic ? 'episodic' : 'vault.semantic',
      confidence: 0.8,
      reason: episodic ? 'Session/memory with temporal cues' : 'Long-lived memory note',
      selectedByDefault: true,
    }
  }

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

  // How-to
  if (/\b(how to|howto|runbook|checklist|procedure|lépés|útmutató)\b/i.test(content.slice(0, 500))) {
    return {
      kind: 'memory',
      target: 'vault.procedural',
      confidence: 0.7,
      reason: 'How-to / runbook style content',
      selectedByDefault: true,
    }
  }

  // Generic markdown
  if (base.endsWith('.md') || base.endsWith('.markdown') || base.endsWith('.txt')) {
    return {
      kind: 'memory',
      target: 'vault.semantic',
      confidence: 0.55,
      reason: 'Generic text note — review before import',
      selectedByDefault: content.trim().length > 80,
    }
  }

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
