// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory } from '@modules/data-port/scanners/scan-path'

let root: string
beforeEach(() => {
  root = join(tmpdir(), `eyas-scan-${process.pid}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(root, '.claude', 'skills', 'deploy', 'scripts'), { recursive: true })
  mkdirSync(join(root, '.claude', 'skills', 'deploy', 'references'), { recursive: true })
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(root, '.grok', 'memory', 'proj-1', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'ai-memory'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'skills', 'deploy', 'SKILL.md'),
    '---\nname: deploy\ndescription: Use when "deploy docs"\n---\n# Deploy\nRun scripts/deploy.sh',
  )
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'scripts', 'deploy.sh'), '#!/bin/sh\necho hi\n')
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'references', 'notes.md'), '# Notes\nmore')
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'scripts', 'x.pyc'), Buffer.from([0, 1, 2]))
  writeFileSync(join(root, '.claude', 'agents', 'dev.md'), '---\nname: dev\ndescription: d\n---\nprompt')
  writeFileSync(
    join(root, '.grok', 'memory', 'proj-1', 'sessions', '2026-09-05-x-01a0abcd.md'),
    '## Session Summary\n\n- **Messages:** 1 user',
  )
  writeFileSync(join(root, 'ai-memory', 'big.md'), `---\ntype: reference\n---\n${'x'.repeat(20_000)}`)
  writeFileSync(join(root, 'ai-memory', 'bullets.md'), '---\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n')
  writeFileSync(join(root, 'ai-memory', 'huge.md'), 'y'.repeat(5 * 1024 * 1024))
  writeFileSync(join(root, 'secret.env'), 'API_KEY=abcdefghijklmnopqrstuvwxyz')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanDirectory', () => {
  it('reads whole files: the 20k note carries its full size and a hash, no content field', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const big = r.candidates.find((c) => c.relativePath === 'ai-memory/big.md')!
    expect(big.bytes).toBeGreaterThan(20_000)
    expect(big.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(big.sourcePath).toBe(join(root, 'ai-memory', 'big.md'))
    expect(big.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(big.content).toBeUndefined()
  })

  // R11.1: nothing is refused for its size and nothing is refused for holding a
  // key. The 5 MiB note is a note, the `.env` is importable text, and both say
  // what they are.
  it('imports the oversized note and the key file, and counts only real noise as skipped', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const huge = r.candidates.find((c) => c.relativePath === 'ai-memory/huge.md')!
    expect(huge).toMatchObject({ kind: 'memory', selectedByDefault: true })
    expect(huge.warnings).toEqual(['large-file', 'secrets-scan-head-only'])
    expect(huge.target).not.toBe('none')
    const secret = r.candidates.find((c) => c.relativePath === 'secret.env')!
    expect(secret).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false })
    expect(secret.tags).toContain('contains-secrets')
    expect(secret.target).not.toBe('none')
    expect(r.stats.filesSkipped).toBe(r.candidates.filter((c) => c.kind === 'noise').length)
  })

  it('gives every noise row a kebab-case reason code', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const noise = r.candidates.filter((c) => c.kind === 'noise')
    expect(noise.length).toBeGreaterThan(0)
    for (const n of noise) {
      expect(n.reasonCode).toMatch(/^[a-z][a-z0-9-]*(:[a-z0-9_-]+)?$/)
      expect(n.reason.length).toBeGreaterThan(0)
    }
  })

  it('keeps bullet-heavy notes and bundles skill assets under the SKILL.md candidate', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'ai-memory/bullets.md')?.kind).toBe('memory')
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    expect(skill.kind).toBe('skill')
    expect(skill.assets?.map((a) => a.relPath).sort()).toEqual(['references/notes.md', 'scripts/deploy.sh'])
    expect(skill.reason).toMatch(/\+2 bundled files/)
    expect(r.candidates.some((c) => c.relativePath.endsWith('references/notes.md'))).toBe(false)
  })

  it('reaches Grok project sessions and persona files', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath.includes('proj-1/sessions/'))).toMatchObject({
      kind: 'session',
      target: 'episodic',
      selectedByDefault: true,
    })
    expect(r.candidates.find((c) => c.relativePath === '.claude/agents/dev.md')).toMatchObject({
      kind: 'persona',
      target: 'agent',
    })
  })

  it('expands container files into units with the container path and a unit id', async () => {
    writeFileSync(
      join(root, 'conversations.json'),
      JSON.stringify([{ uuid: 'u1', name: 'Plan', chat_messages: [{ sender: 'human', text: 'hi' }] }]),
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const u = r.candidates.find((c) => c.relativePath === 'conversations.json')!
    expect(u.unit).toBe('u1')
    expect(u.kind).toBe('session')
    expect(u.adapterId).toBe('chat-export')
  })
})

describe('scanDirectory provenance tags', () => {
  it('tags third-party documentation and a legacy memory backup', async () => {
    mkdirSync(join(root, '.grok', 'docs', 'user-guide'), { recursive: true })
    writeFileSync(join(root, '.grok', 'docs', 'user-guide', 'x.md'), '# Guide\nHow the tool works.\n')
    mkdirSync(join(root, 'memory.local-backup-1'), { recursive: true })
    writeFileSync(join(root, 'memory.local-backup-1', 'x.md'), '# Old note\nStill the owner’s.\n')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === '.grok/docs/user-guide/x.md')?.tags).toEqual([
      'third-party',
    ])
    expect(r.candidates.find((c) => c.relativePath === 'memory.local-backup-1/x.md')?.tags).toEqual(['legacy'])
  })
})

describe('scanDirectory merged paths', () => {
  it('records a vault reached through two directory symlinks as one candidate with three paths', async () => {
    mkdirSync(join(root, 'vault', 'ai-memory'), { recursive: true })
    writeFileSync(join(root, 'vault', 'ai-memory', 'shared.md'), '---\ntype: reference\n---\nshared fact\n')
    symlinkSync(join(root, 'vault'), join(root, 'link-a'), 'dir')
    symlinkSync(join(root, 'vault'), join(root, 'link-b'), 'dir')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const rows = r.candidates.filter((c) => c.relativePath.endsWith('ai-memory/shared.md'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.paths?.slice().sort()).toEqual([
      'link-a/ai-memory/shared.md',
      'link-b/ai-memory/shared.md',
      'vault/ai-memory/shared.md',
    ])
  })

  it('keeps one candidate for identical bytes and lists the other as duplicate-content', async () => {
    const body = '---\ntype: reference\n---\nthe very same fact\n'
    writeFileSync(join(root, 'ai-memory', 'twin-a.md'), body)
    writeFileSync(join(root, 'ai-memory', 'twin-b.md'), body)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const kept = r.candidates.filter((c) => c.kind === 'memory' && /twin-[ab]\.md$/.test(c.relativePath))
    expect(kept).toHaveLength(1)
    expect(kept[0]!.paths?.slice().sort()).toEqual(['ai-memory/twin-a.md', 'ai-memory/twin-b.md'])
    const dup = r.candidates.find((c) => c.reasonCode === 'duplicate-content')!
    expect(dup.kind).toBe('noise')
    expect(dup.reason).toMatch(/duplicate content of ai-memory\/twin-[ab]\.md/i)
  })
})

describe('scanDirectory skill packages', () => {
  it('flags a binary bundled asset and hashes it', async () => {
    writeFileSync(
      join(root, '.claude', 'skills', 'deploy', 'references', 'logo.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a]),
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    const logo = skill.assets?.find((a) => a.relPath === 'references/logo.png')!
    expect(logo.binary).toBe(true)
    expect(logo.sha256).toMatch(/^[0-9a-f]{64}$/)
    const md = skill.assets?.find((a) => a.relPath === 'references/notes.md')!
    expect(md.binary).toBe(false)
  })

  it('bundles a file with the longest matching skill directory', async () => {
    mkdirSync(join(root, '.claude', 'skills', 'deploy', 'nested'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'skills', 'deploy', 'nested', 'SKILL.md'),
      '---\nname: nested\ndescription: d\n---\n# Nested\n',
    )
    writeFileSync(join(root, '.claude', 'skills', 'deploy', 'nested', 'helper.md'), '# Helper\n')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const outer = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    const inner = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/nested/SKILL.md')!
    expect(inner.assets?.map((a) => a.relPath)).toEqual(['helper.md'])
    expect(outer.assets?.map((a) => a.relPath).sort()).toEqual(['references/notes.md', 'scripts/deploy.sh'])
  })

  it('lists a compiled artefact inside a skill package as a visible row', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath.endsWith('scripts/x.pyc'))!
    expect(row).toMatchObject({ kind: 'noise', target: 'none', reasonCode: 'binary' })
  })

  // R11.1: an asset is never dropped for its size. It rides on the document,
  // marked, and gets no row of its own.
  it('bundles an oversized skill asset instead of listing or dropping it', async () => {
    writeFileSync(join(root, '.claude', 'skills', 'deploy', 'references', 'dump.md'), 'z'.repeat(5 * 1024 * 1024))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.some((c) => c.relativePath.endsWith('references/dump.md'))).toBe(false)
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    const dump = skill.assets?.find((a) => a.relPath === 'references/dump.md')!
    expect(dump.bytes).toBe(5 * 1024 * 1024)
    expect(dump.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(skill.notBundled).toBeUndefined()
    // It is counted as a large file even though it never became a row of its own.
    expect(r.stats.largeFiles).toBeGreaterThanOrEqual(1)
  })
})

describe('scanDirectory uploads (followSymlinks: false)', () => {
  it('lists a symlink as a symlink-upload row and never follows it', async () => {
    const outside = join(tmpdir(), `eyas-scan-out-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'escaped.md'), '---\ntype: reference\n---\nnot yours\n')
    symlinkSync(join(outside, 'escaped.md'), join(root, 'ai-memory', 'escaped.md'))
    try {
      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto', followSymlinks: false })
      const row = r.candidates.find((c) => c.relativePath === 'ai-memory/escaped.md')!
      expect(row).toMatchObject({ kind: 'noise', reasonCode: 'symlink-upload', selectedByDefault: false })
      expect(r.candidates.filter((c) => c.relativePath === 'ai-memory/escaped.md')).toHaveLength(1)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('follows the same symlink when followSymlinks is left on', async () => {
    const outside = join(tmpdir(), `eyas-scan-out2-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'escaped.md'), '---\ntype: reference\n---\nlinked in\n')
    symlinkSync(join(outside, 'escaped.md'), join(root, 'ai-memory', 'escaped.md'))
    try {
      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
      expect(r.candidates.find((c) => c.relativePath === 'ai-memory/escaped.md')?.kind).toBe('memory')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('scanDirectory large files and app state', () => {
  it('leaves a multi-megabyte container unmarked: its threshold is the container one', async () => {
    writeFileSync(join(root, 'ai-memory', 'export.jsonl'), `${'{"role":"user","text":"hi"}'}\n`.repeat(180_000))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath === 'ai-memory/export.jsonl')!
    expect(row.kind).not.toBe('noise')
    expect(row.warnings ?? []).not.toContain('large-file')
  })

  it('lists a derived database as a noise row rather than dropping it', async () => {
    writeFileSync(join(root, 'ai-memory', 'notes.sqlite'), Buffer.from('SQLite format 3\x00rows'))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'ai-memory/notes.sqlite')).toMatchObject({
      kind: 'noise',
      target: 'none',
      reasonCode: 'derived-index',
    })
  })

  // D-8 / A-10: Obsidian's own state is ordinary text — visible, importable,
  // unticked. It was never application state to be hidden.
  it('lists .obsidian state as importable configuration text', async () => {
    mkdirSync(join(root, '.obsidian'), { recursive: true })
    writeFileSync(join(root, '.obsidian', 'app.json'), '{"legacyEditor":false}')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath === '.obsidian/app.json')!
    expect(row).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(row.target).not.toBe('none')
  })

  it('says how many rows were skipped', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.warnings.find((w) => w.code === 'rows-passed-over')?.params?.count).toBe(r.stats.filesSkipped)
  })
})

describe('scanDirectory assistant config JSON', () => {
  it('lists unrecognised JSON under an assistant dot-dir as importable configuration', async () => {
    writeFileSync(join(root, '.claude', 'settings.json'), '{"theme":"dark"}')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === '.claude/settings.json')).toMatchObject({
      kind: 'knowledge',
      reasonCode: 'config',
      target: 'vault.semantic',
      selectedByDefault: false,
    })
  })
})

describe('scanDirectory file symlink aliases', () => {
  // Listing order is the filesystem's: whichever name the walker reaches first
  // carries the row, and the other travels on it as an alias path.
  for (const { real, alias } of [
    { real: 'b-real.md', alias: 'a-alias.md' },
    { real: 'a-real.md', alias: 'b-alias.md' },
  ]) {
    it(`lists one candidate for ${real} when ${alias} points at it`, async () => {
      const dir = join(root, 'ai-memory')
      writeFileSync(join(dir, real), '---\ntype: reference\n---\nan aliased fact\n')
      symlinkSync(join(dir, real), join(dir, alias))

      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
      const rows = r.candidates.filter(
        (c) => c.relativePath.endsWith(real) || c.relativePath.endsWith(alias),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.paths?.slice().sort()).toEqual([`ai-memory/${alias}`, `ai-memory/${real}`].sort())
    })
  }
})

describe('scanDirectory orphaned skill assets', () => {
  it('lists the bundled files of a SKILL.md that never became a skill row', async () => {
    // The document is byte-identical to another package's, so it is listed as a
    // duplicate — and its own files must still be visible, each saying why.
    for (const name of ['alpha', 'bravo']) {
      mkdirSync(join(root, '.claude', 'skills', name, 'scripts'), { recursive: true })
      writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), '# Same document\n')
      writeFileSync(join(root, '.claude', 'skills', name, 'scripts', 'run.sh'), '#!/bin/sh\necho run\n')
    }

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const dup = r.candidates.find((c) => c.reasonCode === 'duplicate-content')!
    expect(dup.relativePath).toMatch(/\.claude\/skills\/(alpha|bravo)\/SKILL\.md$/)
    const asset = r.candidates.find((c) => c.reasonCode === 'orphan-asset')!
    expect(asset).toMatchObject({ kind: 'noise', target: 'none' })
    expect(asset.relativePath).toBe(`${dup.relativePath.replace(/SKILL\.md$/, '')}scripts/run.sh`)
    expect(asset.reason).toMatch(/Duplicate content of/)
    expect(r.stats.filesSkipped).toBe(r.candidates.filter((c) => c.kind === 'noise').length)
  })
})

describe('scanDirectory derived state files', () => {
  it('lists a stray database, a write-ahead log and a lockfile as rows', async () => {
    mkdirSync(join(root, 'x'), { recursive: true })
    writeFileSync(join(root, 'x', 'index.db'), 'not really a database')
    writeFileSync(join(root, 'y.sqlite-wal'), 'write-ahead log')
    writeFileSync(join(root, 'bun.lock'), 'lockfile')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'x/index.db')).toMatchObject({
      kind: 'noise',
      target: 'none',
      reasonCode: 'derived-index',
    })
    expect(r.candidates.find((c) => c.relativePath === 'y.sqlite-wal')).toMatchObject({
      kind: 'noise',
      target: 'none',
      reasonCode: 'derived-index',
    })
    expect(r.candidates.find((c) => c.relativePath === 'bun.lock')?.kind).toBe('noise')
  })

  it('titles a database row from its file name, never from decoded bytes', async () => {
    writeFileSync(
      join(root, 'ai-memory', 'notes.sqlite'),
      Buffer.concat([Buffer.from('SQLite format 3 '), Buffer.from('# Not a heading\n')]),
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath === 'ai-memory/notes.sqlite')!
    expect(row.title).toBe('notes.sqlite')
    expect(row.preview).not.toMatch(/Not a heading/)
  })
})

describe('scanDirectory rooted at a Claude project directory', () => {
  const seedProject = (): string => {
    const projectRoot = join(root, '.claude', 'projects', 'slug')
    mkdirSync(join(projectRoot, 'memory'), { recursive: true })
    writeFileSync(join(projectRoot, 'x.jsonl'), '{"type":"user","message":{"role":"user","content":"hi"}}\n')
    writeFileSync(join(projectRoot, 'memory', 'n.md'), '---\ntype: user\n---\nme')
    return projectRoot
  }

  // Picking the profile is the signal that this tree is Claude Code's; rooted
  // inside one project the paths keep no `.claude/` marker to detect it from.
  it('lists the transcript as a selected session claimed by the claude-code adapter', async () => {
    const projectRoot = seedProject()
    const r = await scanDirectory({ rootPath: projectRoot, sourceProfile: 'claude-code' })
    expect(r.candidates.find((c) => c.relativePath === 'x.jsonl')).toMatchObject({
      kind: 'session',
      target: 'episodic',
      selectedByDefault: true,
      adapterId: 'claude-code',
    })
  })

  it('still lists the transcript as a selected session under auto', async () => {
    const projectRoot = seedProject()
    const r = await scanDirectory({ rootPath: projectRoot, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'x.jsonl')).toMatchObject({
      kind: 'session',
      target: 'episodic',
      selectedByDefault: true,
    })
  })

  // R11.2: a home scan holds nothing back. The transcripts of every project are
  // listed beside the memory notes.
  it('lists the transcripts of a home scan and still reaches the memory note', async () => {
    seedProject()
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === '.claude/projects/slug/x.jsonl')).toMatchObject({
      kind: 'session',
      target: 'episodic',
    })
    expect(r.candidates.some((c) => c.relativePath === '.claude/projects/slug/memory/n.md')).toBe(true)
  })
})

describe('scanDirectory secrets inside a skill package', () => {
  // The walker lifts the texty-name filter inside a package, so these files are
  // collected. R11.4: a key is a FLAG, never a refusal — the file is bundled
  // verbatim and the package carries the tag.
  const seed = (name: string, content: string): void => {
    writeFileSync(join(root, '.claude', 'skills', 'deploy', name), content)
  }

  it('bundles a key file and tags the package instead of refusing it', async () => {
    seed('.env', 'OPENAI_API_KEY=sk-alphaalphaalphaalphaalphaalpha0001\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.some((c) => c.relativePath === '.claude/skills/deploy/.env')).toBe(false)
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    expect(skill.assets?.find((a) => a.relPath === '.env')?.containsSecrets).toBe(true)
    expect(skill.tags).toContain('contains-secrets')
    expect(skill.notBundled).toBeUndefined()
  })

  it('flags every shape of secret in a package', async () => {
    seed('credentials.json', '{"token":"alpha"}')
    seed('server.pem', '-----BEGIN RSA PRIVATE KEY-----\nalpha\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    for (const name of ['credentials.json', 'server.pem']) {
      expect(skill.assets?.find((a) => a.relPath === name)?.containsSecrets).toBe(true)
    }
    expect(skill.tags).toContain('contains-secrets')
  })

  it('keeps bundling the ordinary files of the package', async () => {
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    expect(skill.assets?.map((a) => a.relPath)).toEqual(['references/notes.md', 'scripts/deploy.sh'])
    expect(skill.notBundled).toBeUndefined()
    expect(skill.tags ?? []).not.toContain('contains-secrets')
  })
})

describe('scanDirectory secrets past the classification head', () => {
  it('imports a note whose key sits beyond the head and tags it', async () => {
    writeFileSync(
      join(root, 'ai-memory', 'long.md'),
      `---\ntype: reference\n---\n${'filler text '.repeat(1200)}\nAPI_KEY=alphaalphaalpha0001\n`,
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath === 'ai-memory/long.md')!
    expect(row).toMatchObject({ kind: 'memory', selectedByDefault: true })
    expect(row.tags).toContain('contains-secrets')
  })
})

describe('scanDirectory skill package identity', () => {
  // A skill is its SKILL.md AND the files bundled with it: two packages sharing
  // a document but not their scripts are two packages, and calling the second a
  // duplicate strands its files as unimportable orphan rows (I6).
  const seedTwin = (dir: string, script: string): void => {
    mkdirSync(join(root, ...dir.split('/'), 'scripts'), { recursive: true })
    writeFileSync(join(root, ...dir.split('/'), 'SKILL.md'), '---\nname: alpha\ndescription: twin\n---\n# Alpha\n')
    writeFileSync(join(root, ...dir.split('/'), 'scripts', script), `#!/bin/sh\necho ${script}\n`)
  }

  it('lists both packages when the same SKILL.md ships different files', async () => {
    seedTwin('.claude/skills/alpha', 'one.py')
    seedTwin('.agents/skills/alpha', 'two.py')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skills = r.candidates.filter((c) => c.kind === 'skill' && c.relativePath.endsWith('alpha/SKILL.md'))
    expect(skills).toHaveLength(2)
    expect(r.candidates.filter((c) => c.reasonCode === 'orphan-asset')).toHaveLength(0)
    expect(skills.flatMap((c) => c.assets?.map((a) => a.relPath) ?? []).sort()).toEqual([
      'scripts/one.py',
      'scripts/two.py',
    ])
  })

  it('still calls a package with identical files a duplicate', async () => {
    seedTwin('.claude/skills/bravo', 'same.py')
    seedTwin('.agents/skills/bravo', 'same.py')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skills = r.candidates.filter((c) => c.kind === 'skill' && c.relativePath.endsWith('bravo/SKILL.md'))
    expect(skills).toHaveLength(1)
    expect(
      r.candidates.some((c) => c.reasonCode === 'duplicate-content' && c.relativePath.endsWith('bravo/SKILL.md')),
    ).toBe(true)
  })
})

describe('scanDirectory declared rule scope', () => {
  it('carries the globs a Cursor rule declares onto the candidate', async () => {
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(root, '.cursor', 'rules', 'alpha.mdc'), '---\nglobs: src/**/*.ts\n---\nUse strict mode.\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === '.cursor/rules/alpha.mdc')).toMatchObject({
      kind: 'rule',
      scope: 'src/**/*.ts',
    })
  })

  // The other shape of a declared scope: Copilot writes `applyTo` where Cursor
  // writes `globs`, and both have to reach the candidate the same way.
  it('carries the applyTo a Copilot instructions file declares onto the candidate', async () => {
    mkdirSync(join(root, '.github', 'instructions'), { recursive: true })
    writeFileSync(
      join(root, '.github', 'instructions', 'alpha.instructions.md'),
      '---\napplyTo: "**/*.py"\n---\nUse type hints.\n',
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === '.github/instructions/alpha.instructions.md')).toMatchObject(
      { kind: 'rule', scope: '**/*.py' },
    )
  })

  it('leaves scope unset for a rules file that declares none', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# Rules\nAlways write tests.\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'CLAUDE.md')?.scope).toBeUndefined()
  })
})

describe('scanDirectory a project directory reached twice', () => {
  // A project directory reached under a name of its own is still the same
  // directory: the walker decides on the REAL path, so it is walked once and
  // both names travel on the rows (A7).
  it('lists the transcript once, with every path it lives at', async () => {
    const project = join(root, 'proj', '.claude', 'projects', 'slug')
    mkdirSync(join(project, 'memory'), { recursive: true })
    writeFileSync(join(project, 'a.jsonl'), '{"type":"user","message":{"role":"user","content":"hi"}}\n')
    writeFileSync(join(project, 'memory', 'note.md'), '---\ntype: feedback\n---\nPrefer short answers.\n')
    mkdirSync(join(root, 'notes'), { recursive: true })
    symlinkSync(project, join(root, 'notes', 'shortcut'), 'dir')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const rows = r.candidates.filter((c) => c.relativePath.endsWith('a.jsonl'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.paths?.slice().sort()).toEqual([
      'notes/shortcut/a.jsonl',
      'proj/.claude/projects/slug/a.jsonl',
    ])
    expect(r.candidates.some((c) => c.relativePath.endsWith('memory/note.md'))).toBe(true)
  })
})

describe('scanDirectory paths on an oversized row', () => {
  it('lists every path an oversized file lives at, and imports it', async () => {
    const dir = join(root, 'ai-memory')
    writeFileSync(join(dir, 'huge-real.md'), 'w'.repeat(5 * 1024 * 1024))
    symlinkSync(join(dir, 'huge-real.md'), join(dir, 'huge-link.md'))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const rows = r.candidates.filter((c) => c.relativePath.startsWith('ai-memory/huge-'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).not.toBe('noise')
    expect(rows[0]!.warnings).toContain('large-file')
    expect(rows[0]!.paths?.slice().sort()).toEqual(['ai-memory/huge-link.md', 'ai-memory/huge-real.md'])
  })
})
