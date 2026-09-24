// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  expandHome,
  extractShellPathCandidates,
  literalGlobPrefix,
  pathCandidatesFromArgv,
} from '@shared/memory-sovereignty/shell-paths.js'

const HOME = '/tmp/eyas-shell-home'
const CWD = '/tmp/eyas-shell-work'
const opts = { homeDir: HOME, cwd: CWD }

describe('extractShellPathCandidates — positive', () => {
  it('expands $HOME inside a quoted argument with spaces (vault search)', () => {
    const got = extractShellPathCandidates('rg -lil "x" "$HOME/Test Vault/notes"', opts)
    expect(got).toContain(join(HOME, 'Test Vault', 'notes'))
  })

  it('expands ~ in a plain argument', () => {
    expect(extractShellPathCandidates('cat ~/.grok/memory/x', opts)).toContain(join(HOME, '.grok', 'memory', 'x'))
  })

  it('finds an append-redirection target, glued or spaced', () => {
    expect(extractShellPathCandidates('echo x >> ~/.claude/CLAUDE.md', opts)).toContain(join(HOME, '.claude', 'CLAUDE.md'))
    expect(extractShellPathCandidates('echo x>>~/.claude/CLAUDE.md', opts)).toContain(join(HOME, '.claude', 'CLAUDE.md'))
  })

  it('expands ${HOME} and keeps the trailing folder', () => {
    expect(extractShellPathCandidates('cp a.md "${HOME}/.codex/"', opts)).toContain(join(HOME, '.codex'))
  })

  it('reads --flag=value, VAR=value and file:// URLs', () => {
    expect(extractShellPathCandidates('tool --out=/data/x.txt', opts)).toContain('/data/x.txt')
    expect(extractShellPathCandidates('DIR=~/.kimi run', opts)).toContain(join(HOME, '.kimi'))
    expect(extractShellPathCandidates('open file:///etc/hosts', opts)).toContain('/etc/hosts')
  })

  it('looks inside command substitutions, quoted or not', () => {
    expect(extractShellPathCandidates('echo $(cat ~/.gemini/a)', opts)).toContain(join(HOME, '.gemini', 'a'))
    expect(extractShellPathCandidates('echo "$(cat ~/.gemini/b)"', opts)).toContain(join(HOME, '.gemini', 'b'))
    expect(extractShellPathCandidates('echo `cat ~/.gemini/c`', opts)).toContain(join(HOME, '.gemini', 'c'))
  })

  it('resolves relative paths against cwd and cuts globs at the first wildcard', () => {
    expect(extractShellPathCandidates('cat notes/a.md', opts)).toContain(join(CWD, 'notes', 'a.md'))
    expect(extractShellPathCandidates('ls ~/.claude/projects/*/memory', opts)).toContain(join(HOME, '.claude', 'projects'))
  })

  it('expands ~user to a sibling home', () => {
    expect(expandHome('~other/.claude', HOME)).toBe('/tmp/other/.claude')
  })
})

describe('extractShellPathCandidates — shell grammar', () => {
  it('(+) a redirection target is a path; the command goes on after it', () => {
    expect(extractShellPathCandidates('grep x 2>~/.claude/log', opts)).toContain(join(HOME, '.claude', 'log'))
    expect(extractShellPathCandidates('cat<~/.grok/x', opts)).toContain(join(HOME, '.grok', 'x'))
    expect(extractShellPathCandidates('cat 2>/dev/null ~/.codex/a', opts)).toContain(join(HOME, '.codex', 'a'))
  })

  it('(+) brace alternatives are every path they stand for (not in an argv, which no shell expands)', () => {
    expect(extractShellPathCandidates('cat ~/{.claude,x}/CLAUDE.md', opts)).toContain(join(HOME, '.claude', 'CLAUDE.md'))
    expect(pathCandidatesFromArgv(['~/{.claude,x}/CLAUDE.md'], opts)).toEqual([join(HOME, '{.claude,x}', 'CLAUDE.md')])
  })

  it('(+) here-document and here-string text keeps naming paths (a program may run it as a script)', () => {
    expect(extractShellPathCandidates("python3 - <<'EOF'\nopen('/srv/x/.claude/CLAUDE.md')\nEOF", opts)).toContain('/srv/x/.claude/CLAUDE.md')
    expect(extractShellPathCandidates("bash <<< 'cat ~/.grok/memory/a.md'", opts)).toContain(join(HOME, '.grok', 'memory', 'a.md'))
  })

  it('(−) an unbalanced quote in a here-document does not hide the lines after it', () => {
    const got = extractShellPathCandidates("cat > a.md <<'EOF'\ndon't\nEOF\ncat ~/.codex/x", opts)
    expect(got).toContain(join(HOME, '.codex', 'x'))
  })

  it('(−) a descriptor number is not a word', () => {
    expect(extractShellPathCandidates('ls 2>&1', opts)).toEqual([])
  })
})

describe('extractShellPathCandidates — negative', () => {
  it('finds nothing in git status', () => {
    expect(extractShellPathCandidates('git status', opts)).toEqual([])
  })

  it('does not take a bare search pattern for a path', () => {
    const got = extractShellPathCandidates('grep -r ai-memory src', opts)
    expect(got.some((p) => p.includes('ai-memory'))).toBe(false)
  })

  it('ignores quoted prose that mentions a store', () => {
    const got = extractShellPathCandidates('echo "remember that ~/.claude/memory is not ours"', opts)
    expect(got.some((p) => p.includes('.claude'))).toBe(false)
  })

  it('ignores web URLs and comments', () => {
    expect(extractShellPathCandidates('curl https://example.com/a/b # ~/.claude/x', opts)).toEqual([])
  })

  it('leaves a relative candidate relative without a cwd', () => {
    expect(extractShellPathCandidates('cat a/b.md', { homeDir: HOME })).toEqual(['a/b.md'])
  })
})

describe('pathCandidatesFromArgv', () => {
  it('treats each argv item as one word', () => {
    expect(pathCandidatesFromArgv(['-la', '~/.codex'], opts)).toContain(join(HOME, '.codex'))
    expect(pathCandidatesFromArgv(['/Users/x/My Vault/a.md'], opts)).toContain('/Users/x/My Vault/a.md')
  })

  it('skips flags, words and non-strings', () => {
    expect(pathCandidatesFromArgv(['-la', 'status', 42, null], opts)).toEqual([])
  })
})

describe('literalGlobPrefix', () => {
  it('cuts at the first wildcard segment', () => {
    expect(literalGlobPrefix('/a/b/**/*.md')).toBe('/a/b')
    expect(literalGlobPrefix('src/*.ts')).toBe('src')
    expect(literalGlobPrefix('*.md')).toBe('')
    expect(literalGlobPrefix('/*')).toBe('/')
  })
})
