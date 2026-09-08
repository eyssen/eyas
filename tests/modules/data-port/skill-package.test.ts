// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  MAX_INLINE_ASSET_CHARS,
  assembleSkillContent,
  assembleSkillContentLegacy,
  appendSourceFrontmatterLegacy,
  buildSkillFromPackage,
  deriveTriggers,
  fenceLanguage,
} from '@modules/data-port/skill-package'
import { splitFrontmatter, legacyBody } from '@modules/data-port/source-frontmatter'
import { applySkillItem, contentSha, packageDigest } from '@modules/data-port/pipeline/apply'

const SKILL = [
  '---',
  'name: alpha-ticket',
  'description: |',
  '  Fetch a ticket by ID.',
  '  Use when: user says "ticket 123", „nézd meg a 456-os ticketet", or "alpha ticket".',
  '---',
  '# Alpha Ticket Fetcher',
  '',
  'Run `scripts/fetch_ticket.py`.',
  '',
].join('\n')

describe('skill package', () => {
  it('derives triggers from quoted phrases, the name and the H1', () => {
    expect(
      deriveTriggers('alpha-ticket', 'Use when "ticket 123", „nézd meg a 456-os ticketet"', 'Alpha Ticket Fetcher'),
    ).toEqual(['ticket 123', 'nézd meg a 456-os ticketet', 'alpha-ticket', 'alpha ticket', 'Alpha Ticket Fetcher'])
  })

  it('picks fence languages by extension', () => {
    expect(fenceLanguage('scripts/a.py')).toBe('python')
    expect(fenceLanguage('scripts/a.sh')).toBe('bash')
    expect(fenceLanguage('references/x.md')).toBe('')
    expect(fenceLanguage('data.json')).toBe('json')
  })

  it('appends every asset verbatim, markdown inline and code fenced', () => {
    const c = assembleSkillContent(
      '# Body',
      [
        { relPath: 'references/r.md', content: '# Ref\ntext' },
        { relPath: 'scripts/a.py', content: 'print(1)' },
      ],
      '/data/skills/imported/alpha-ticket',
    )
    expect(c).toContain('# Body\n\n---\n\n## Bundled files (imported verbatim)')
    expect(c).toContain('Files are also stored at `/data/skills/imported/alpha-ticket/`')
    expect(c).toContain('### references/r.md\n\n# Ref\ntext')
    expect(c).toContain('### scripts/a.py\n\n```python\nprint(1)\n```')
  })

  it('keeps an asset that contains a code fence verbatim by widening the fence', () => {
    const inner = 'Docs:\n```js\nconst a = 1\n```\ndone'
    const c = assembleSkillContent('# Body', [{ relPath: 'scripts/a.sh', content: inner }], null)
    expect(c).toContain(inner)
    expect(c).toContain('````bash\n')
  })

  it('lists a binary asset instead of inlining it', () => {
    const c = assembleSkillContent(
      '# Body',
      [{ relPath: 'assets/logo.png', content: Buffer.alloc(2048), binary: true }],
      '/data/skills/imported/alpha-ticket-1234abcd',
    )
    expect(c).toContain('### assets/logo.png (binary, 2 KiB, stored on disk)')
    expect(c).not.toContain('```')
  })

  it('caps a huge text asset inline and keeps the on-disk copy authoritative', () => {
    const c = assembleSkillContent('# Body', [{ relPath: 'data/big.txt', content: 'a'.repeat(200_050) }], null)
    expect(c).toContain('the complete file is data/big.txt')
    expect(c.length).toBeLessThan(201_000)
  })

  it('builds a skill from SKILL.md with full frontmatter and body', () => {
    const s = buildSkillFromPackage({
      relativePath: '.claude/skills/alpha-ticket/SKILL.md',
      raw: SKILL,
      assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }],
    })
    expect(s.name).toBe('alpha-ticket')
    expect(s.description).toBe(
      'Fetch a ticket by ID.\nUse when: user says "ticket 123", „nézd meg a 456-os ticketet", or "alpha ticket".',
    )
    expect(s.trigger_patterns).toEqual([
      'ticket 123',
      'nézd meg a 456-os ticketet',
      'alpha ticket',
      'alpha-ticket',
      'Alpha Ticket Fetcher',
    ])
    expect(s.content.startsWith('# Alpha Ticket Fetcher')).toBe(true)
    // The body is the SKILL.md body ONLY — bundled files are appended at apply time.
    expect(s.content).not.toContain('### scripts/')
    expect(s.assets).toHaveLength(1)
    expect(s.assets[0].relPath).toBe('scripts/fetch_ticket.py')
    expect(s.sourcePath).toBe('.claude/skills/alpha-ticket/SKILL.md')
    expect(s.skill_type).toBe('knowledge')
  })

  it('names a SKILL.md without frontmatter after its directory', () => {
    expect(
      buildSkillFromPackage({ relativePath: 'notes/scheduled/daily-review/SKILL.md', raw: 'Daily review.', assets: [] })
        .name,
    ).toBe('daily-review')
  })

  it('names a standalone skill file after its own stem, not its folder', () => {
    expect(
      buildSkillFromPackage({ relativePath: '.claude/commands/deploy.md', raw: '# Deploy', assets: [] }).name,
    ).toBe('deploy')
  })

  describe('frontmatter EYAS has no field for', () => {
    const withExtras = (extra: string[]): string =>
      ['---', 'name: alpha-ticket', 'description: Fetch a ticket.', ...extra, '---', '# Body', ''].join('\n')

    it('keeps every unmapped key in the body instead of dropping it', () => {
      const s = buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: withExtras([
          'allowed-tools: Read, Grep',
          'argument-hint: <ticket id>',
          'model: some-model-id',
          'metadata:',
          '  owner: alpha',
        ]),
        assets: [],
      })
      expect(s.content).toContain('# Body')
      expect(s.content).toContain('## Source frontmatter')
      expect(s.content).toContain('allowed-tools: Read, Grep')
      expect(s.content).toContain('argument-hint: <ticket id>')
      expect(s.content).toContain('model: some-model-id')
      expect(s.content).toContain('owner: alpha')
      // The keys that DID become fields are not repeated as leftovers.
      expect(s.content).not.toContain('name: alpha-ticket')
      expect(s.content).not.toContain('description: Fetch a ticket.')
    })

    it('adds nothing at all when every key was mapped', () => {
      const s = buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: withExtras(['trigger_patterns: [one]', 'capabilities: [two]']),
        assets: [],
      })
      expect(s.content).toBe('# Body\n')
    })

    it('keeps a list the mapper passed over — `tags` beside an explicit `capabilities`', () => {
      const s = buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: withExtras(['capabilities: [one]', 'tags: [two]']),
        assets: [],
      })
      // `capabilities` won, so `tags` fed nothing and would otherwise vanish.
      expect(s.capabilities).toEqual(['one'])
      expect(s.content).toContain('## Source frontmatter')
      expect(s.content).toContain('- two')
    })

    it('widens the fence rather than letting a backticked value close the block early', () => {
      const s = buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: withExtras(['note: "run ``` then stop"']),
        assets: [],
      })
      expect(s.content).toContain('````yaml')
      expect(s.content).toContain('run ``` then stop')
    })

    it('adds nothing to a file with no frontmatter at all', () => {
      const s = buildSkillFromPackage({
        relativePath: 'notes/daily-review/SKILL.md',
        raw: 'Daily review.',
        assets: [],
      })
      expect(s.content).toBe('Daily review.')
    })
  })
})

describe('R11.5 — verbatim body (P-13, P-15, P-20)', () => {
  it('keeps the SKILL.md body byte for byte before the bundled-files section', () => {
    const out = assembleSkillContent('\n# Deploy\n\ntext\n\n', [{ relPath: 'a.sh', content: 'echo\n' }], null)
    expect(out.startsWith('\n# Deploy\n\ntext\n\n\n---\n')).toBe(true)
    expect(out.endsWith('```\n')).toBe(true)
  })

  it('inlines a flagged asset verbatim and marks the package', () => {
    const r = buildSkillFromPackage({
      relativePath: 'x/SKILL.md',
      raw: '---\nname: x\n---\n# x\n',
      assets: [{ relPath: '.env', content: 'API_KEY=alphabravo0123456789\n', containsSecrets: true }],
    })
    expect(r.containsSecrets).toBe(true)
    expect(assembleSkillContent(r.content, r.assets, null)).toContain('### .env')
    expect(buildSkillFromPackage({ relativePath: 'x/SKILL.md', raw: '# x', assets: [] }).containsSecrets).toBeUndefined()
  })

  it('clips only the inline copy and names the complete on-disk file in the marker', () => {
    const big = 'a'.repeat(MAX_INLINE_ASSET_CHARS + 10)
    const out = assembleSkillContent('# x\n', [{ relPath: 'references/dump.md', content: big }], 'skills/imported/x-0123')
    expect(out).toContain('the complete file is skills/imported/x-0123/references/dump.md')
    expect(out).not.toContain('a'.repeat(MAX_INLINE_ASSET_CHARS + 1))
  })

  it('legacy assembly reproduces the pre-amendment trailing-whitespace collapse', () => {
    // `assembleSkillContentLegacy` never touched LEADING body whitespace (only
    // `splitFrontmatter` used to, separately) — so the body's own leading
    // newline survives here too; what it collapses is the body's OWN trailing
    // blank lines (down to the one the section separator supplies) and each
    // asset's trailing whitespace, which the verbatim twin above keeps.
    const legacy = assembleSkillContentLegacy('\n# Deploy\n\ntext\n\n', [{ relPath: 'a.sh', content: 'echo\n' }], null)
    expect(legacy.startsWith('\n# Deploy\n\ntext\n\n---\n')).toBe(true)
    expect(legacy.endsWith('```')).toBe(true)
  })

  it('reaches the same fallback for a SKILL.md with no frontmatter and a leading blank line (I1)', () => {
    // A `.claude/commands/*.md` with no frontmatter goes through the SAME
    // `legacyBody` as a memory note — reconstructing the pre-amendment skill
    // content via `legacyBody` + `appendSourceFrontmatterLegacy` must match
    // what the pre-amendment `buildSkillFromPackage` would have stored.
    const raw = '\n\n# leading blank, no frontmatter\n'
    const { data, body, hadFrontmatter } = splitFrontmatter(raw)
    expect(hadFrontmatter).toBe(false)
    const reconstructed = appendSourceFrontmatterLegacy(legacyBody(body, hadFrontmatter), data)
    // The pre-amendment splitter's no-frontmatter branch only trimmed the
    // tail — the leading blank line was never dropped.
    expect(reconstructed).toBe('\n\n# leading blank, no frontmatter')
    expect(buildSkillFromPackage({ relativePath: 'x/SKILL.md', raw, assets: [] }).content).toBe(raw)
  })
})

describe('assembleSkillContent — "Not bundled" is not a refusal list (A-5, I3)', () => {
  it('names a P-15 clip and a P-17 file without claiming either was left out', () => {
    const out = assembleSkillContent('# Body', [], null, [
      { relPath: 'data/huge.bin', bytes: 683_594 * 1024, reason: 'exceeds-string-limit' },
      {
        relPath: 'references/dump.md',
        bytes: 300_000,
        reason: `inline copy clipped at ${MAX_INLINE_ASSET_CHARS} characters — the complete file is references/dump.md`,
      },
    ])
    expect(out).toContain('### Not bundled')
    expect(out).not.toContain('left out of the import')
    expect(out).toContain('exceeds-string-limit')
    expect(out).toContain('inline copy clipped')
    // A-76: whatever the per-line reason says, the intro promises no copy.
    expect(out).not.toMatch(/complete copy/i)
  })

  it('omits the section entirely when neither reason applies', () => {
    const out = assembleSkillContent('# Body', [{ relPath: 'a.py', content: 'x = 1' }], null, [])
    expect(out).not.toContain('Not bundled')
  })

  /*
   * A-74. The section's intro promised a complete copy under the skill's asset
   * directory, which is true of a clipped inline copy and of a file too large to
   * hold as one string. It is NOT true of a placeholder: its bytes were never on
   * the machine and were deliberately not fetched, so there is no copy anywhere.
   * An agent reading the old sentence would go looking for a file that is not
   * there — the very thing this section exists to prevent.
   */
  /*
   * A-76, one case per REAL producer. The section once described a clipped
   * inline copy and a P-17 file, neither of which can reach it: `inlineText`
   * clips in place and writes its own marker. The rewrite then made it worse by
   * promising "the complete copy is in this skill's asset directory" — false for
   * all three producers, none of which writes anything there.
   */
  it('promises no copy for either producer that never wrote one', () => {
    for (const reason of ['the path resolves outside the package directory', 'it could not be read at import time']) {
      const out = assembleSkillContent('# Body', [], null, [{ relPath: 'a.txt', bytes: 2048, reason }])
      expect(out).toContain('### Not bundled')
      expect(out).toContain(reason)
      // The promise, in every form it has taken.
      expect(out).not.toMatch(/complete copy/i)
      expect(out).not.toMatch(/asset directory:/i)
      expect(out).not.toContain('inline copy was clipped')
      // What is true: it belongs to the package and was not written there.
      expect(out).toMatch(/was not written to this skill's asset directory/i)
    }
  })

  it('does not promise a local copy of a file whose bytes were never here', () => {
    const out = assembleSkillContent('# Body', [], null, [
      { relPath: 'reference.pdf', bytes: 3_000_000, reason: 'stored in the cloud, not on this machine', notDownloaded: true },
    ])
    expect(out).toContain('### Not bundled')
    expect(out).toContain('reference.pdf')
    expect(out).toMatch(/NO local copy/i)
    expect(out).toMatch(/not on this machine/i)
    // The clipped wording — and its promise — must be absent entirely.
    expect(out).not.toContain('inline copy was clipped')
    expect(out).not.toMatch(/complete copy/i)
  })

  it('keeps the two apart when a package has one of each', () => {
    const out = assembleSkillContent('# Body', [], null, [
      { relPath: 'clipped.md', bytes: 300_000, reason: 'inline copy clipped at 200000 characters' },
      { relPath: 'held.pdf', bytes: 3_000_000, reason: 'stored in the cloud, not on this machine', notDownloaded: true },
    ])
    // One heading, two intros, each above its own file. The split survives
    // because the REMEDY differs, not because one of them has a copy.
    expect(out.match(/### Not bundled/g)).toHaveLength(1)
    expect(out).toMatch(/was not written to this skill's asset directory/i)
    expect(out).toMatch(/NO local copy/i)
    expect(out).not.toMatch(/complete copy/i)
    const unwrittenAt = out.indexOf('clipped.md')
    const heldAt = out.indexOf('held.pdf')
    const absentAt = out.search(/NO local copy/i)
    expect(heldAt).toBeGreaterThan(absentAt)
    expect(heldAt).toBeGreaterThan(unwrittenAt)
  })
})

describe('applySkillItem', () => {
  const built = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }],
  })

  it('creates the skill in own/<name>, writes assets, tags the job', async () => {
    const created: any[] = []
    const written: any[] = []
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          writeAssets: (n, a) => {
            written.push([n, a])
            return `/data/skills/imported/${n}`
          },
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    expect(r).toMatchObject({ status: 'applied', kind: 'skill', ref: 'sk1' })
    // The directory carries a content digest so two different skills that sanitise
    // to the same name never share one asset folder.
    expect((r as { assetsDir?: string }).assetsDir).toMatch(/^\/data\/skills\/imported\/alpha-ticket-[0-9a-f]{8}$/)
    expect(created[0]).toMatchObject({ name: 'alpha-ticket', category: 'own/alpha-ticket', skillType: 'knowledge' })
    expect(created[0].capabilities).toEqual(
      expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1']),
    )
    expect(created[0].content).toContain('/data/skills/imported/alpha-ticket-')
    expect(written[0][0]).toMatch(/^alpha-ticket-[0-9a-f]{8}$/)
    expect(written[0][1]).toEqual([{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }])
  })

  it('reports unchanged for an identical existing skill', async () => {
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: () => {
            throw new Error('must not create')
          },
          findByName: () => ({ id: 'sk0', content: assembleSkillContent(built.content, built.assets, '') }),
          writeAssets: () => '',
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    expect(r).toEqual({
      status: 'unchanged',
      ref: 'sk0',
      importJobId: null,
      sha256: contentSha(assembleSkillContent(built.content, built.assets, '')),
      assetsSha256: packageDigest(built, built.assets),
    })
  })

  it('tags a same-name skill whose content differs as a conflict', async () => {
    const created: any[] = []
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk2' }
          },
          findByName: () => ({ id: 'sk0', content: 'a different body' }),
          writeAssets: (n) => `/data/skills/imported/${n}`,
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built, sourceChanged: true },
    )
    expect(r).toMatchObject({ status: 'applied', kind: 'skill', ref: 'sk2' })
    expect(created[0].capabilities).toContain('conflict-with:sk0')
    expect(created[0].capabilities).toContain('source-changed')
  })

  it('still applies without a writeAssets dep, inlining the bundled files', async () => {
    const created: any[] = []
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk3' }
          },
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    expect(r).toEqual({
      status: 'applied',
      kind: 'skill',
      ref: 'sk3',
      sha256: contentSha(created[0].content),
      assetsSha256: packageDigest(built, built.assets),
    })
    expect(created[0].content).toContain('### scripts/fetch_ticket.py')
    expect(created[0].content).not.toContain('Files are also stored at')
  })

  it('skips when the skills service is unavailable', async () => {
    const r = await applySkillItem(
      { createProposal: () => 'p', resolveDefaultAgentId: () => 'a' },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    expect(r).toEqual({ status: 'skipped', reason: 'skills service unavailable', reasonCode: 'service-unavailable' })
  })
})

describe('applySkillItem — asset path safety', () => {
  const withAssets = (assets: { relPath: string; content: string }[]) =>
    buildSkillFromPackage({
      relativePath: '.claude/skills/alpha-ticket/SKILL.md',
      raw: SKILL,
      assets,
    })

  it('drops traversing, absolute and backslash asset paths before writing them', async () => {
    const created: any[] = []
    const written: any[] = []
    const warnings: any[] = []
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        logger: { warn: (o) => warnings.push(o) },
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk9' }
          },
          findByName: () => null,
          writeAssets: (n, a) => {
            written.push([n, a])
            return `/data/skills/imported/${n}`
          },
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        transformed: withAssets([
          { relPath: 'scripts/ok.py', content: 'x = 1' },
          { relPath: '../escape.sh', content: 'rm -rf /' },
          { relPath: 'nested/../../escape2.sh', content: 'rm -rf /' },
          { relPath: '/etc/passwd', content: 'root' },
          { relPath: 'windows\\path.txt', content: 'w' },
        ]),
      },
    )
    expect(r).toMatchObject({ status: 'applied', kind: 'skill', ref: 'sk9' })
    // Only the safe file reaches the writer, and only it is inlined.
    expect(written[0][1]).toEqual([{ relPath: 'scripts/ok.py', content: 'x = 1' }])
    expect(created[0].content).toContain('### scripts/ok.py')
    expect(created[0].content).not.toContain('escape')
    expect(created[0].content).not.toContain('passwd')
    expect(created[0].capabilities).toContain('skipped-unsafe-asset:4')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ jobId: 'j1', skipped: 4 })
  })

  it('keeps a package whose every bundled file is unsafe, with no asset directory', async () => {
    const created: any[] = []
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk10' }
          },
          findByName: () => null,
          writeAssets: () => {
            throw new Error('must not write')
          },
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        transformed: withAssets([{ relPath: '../escape.sh', content: 'rm -rf /' }]),
      },
    )
    expect(r).toMatchObject({
      status: 'applied',
      kind: 'skill',
      ref: 'sk10',
      sha256: contentSha(created[0].content),
    })
    // No files travelled, so the package digest is the SKILL.md's alone.
    expect((r as { assetsSha256?: string }).assetsSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(created[0].capabilities).toContain('skipped-unsafe-asset:1')
  })

  it('leaves a package of safe paths untouched', async () => {
    const written: any[] = []
    const created: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk11' }
          },
          findByName: () => null,
          writeAssets: (n, a) => {
            written.push(a)
            return `/data/skills/imported/${n}`
          },
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        transformed: withAssets([
          { relPath: 'scripts/a.py', content: 'x = 1' },
          { relPath: 'references/dot.in.name.md', content: '# Ref' },
          // A `./` prefix is noise a join collapses, not an escape.
          { relPath: './scripts/b.py', content: 'y = 2' },
        ]),
      },
    )
    expect(written[0]).toHaveLength(3)
    expect(created[0].capabilities.some((c: string) => c.startsWith('skipped-unsafe-asset:'))).toBe(false)
  })
})

describe('applySkillItem — package-wide asset digest', () => {
  const pkg = (script: string) =>
    buildSkillFromPackage({
      relativePath: '.claude/skills/alpha-ticket/SKILL.md',
      raw: SKILL,
      assets: [{ relPath: 'scripts/fetch_ticket.py', content: script }],
    })

  const dirFor = async (transformed: any): Promise<string> => {
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: () => ({ id: 'sk' }),
          findByName: () => null,
          writeAssets: (n) => `/data/skills/imported/${n}`,
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed },
    )
    return (r as { assetsDir: string }).assetsDir
  }

  it('gives a changed bundled script its own directory', async () => {
    const first = await dirFor(pkg('x = 1'))
    const second = await dirFor(pkg('x = 2'))
    expect(first).toMatch(/^\/data\/skills\/imported\/alpha-ticket-[0-9a-f]{8}$/)
    // Same SKILL.md, different script: the previous import's files are not overwritten.
    expect(second).not.toBe(first)
  })

  it('gives the same package the same directory, whatever order the assets arrive in', async () => {
    const forward = await dirFor(
      buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: SKILL,
        assets: [
          { relPath: 'scripts/a.py', content: 'x = 1' },
          { relPath: 'references/r.md', content: '# Ref' },
        ],
      }),
    )
    const reversed = await dirFor(
      buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: SKILL,
        assets: [
          { relPath: 'references/r.md', content: '# Ref' },
          { relPath: 'scripts/a.py', content: 'x = 1' },
        ],
      }),
    )
    expect(reversed).toBe(forward)
  })

  it('folds a renamed bundled file into the digest', async () => {
    const a = await dirFor(
      buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: SKILL,
        assets: [{ relPath: 'scripts/a.py', content: 'x = 1' }],
      }),
    )
    const b = await dirFor(
      buildSkillFromPackage({
        relativePath: '.claude/skills/alpha-ticket/SKILL.md',
        raw: SKILL,
        assets: [{ relPath: 'scripts/b.py', content: 'x = 1' }],
      }),
    )
    expect(b).not.toBe(a)
  })
})

describe('applySkillItem — unchanged against any earlier import', () => {
  const built = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }],
  })
  const changed = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 2' }],
  })

  it('recognises content it already imported, even after a newer same-name row', async () => {
    // The store: content sha -> id, in import order. `findByName` answers with
    // the NEWEST row of that name, which is how a name lookup alone loses A.
    const byContentSha = new Map<string, string>()
    const byName: { id: string; content: string }[] = []
    let n = 0
    const deps = () => ({
      createProposal: () => 'p',
      resolveDefaultAgentId: () => 'a',
      skills: {
        create: (i: any) => {
          const id = `sk${++n}`
          const sha = (i.capabilities as string[])
            .find((c) => c.startsWith('content-sha:'))!
            .slice('content-sha:'.length)
          if (!byContentSha.has(sha)) byContentSha.set(sha, id)
          byName.push({ id, content: i.content })
          return { id }
        },
        findByName: () => byName.at(-1) ?? null,
        findByContentSha: (sha: string) => {
          const id = byContentSha.get(sha)
          return id ? { id } : null
        },
        writeAssets: (dir: string) => `/data/skills/imported/${dir}`,
      },
    })

    const job = { jobId: 'j1', sourceProfile: 'claude-code' as const }
    const a = await applySkillItem(deps(), { ...job, transformed: built })
    expect(a).toMatchObject({ status: 'applied', ref: 'sk1' })

    const aPrime = await applySkillItem(deps(), { ...job, transformed: changed })
    expect(aPrime).toMatchObject({ status: 'applied', ref: 'sk2' })

    // A again: the newest same-name row is now A', so only the content lookup
    // can recognise it — and it points back at the original.
    const again = await applySkillItem(deps(), { ...job, transformed: built })
    expect(again).toMatchObject({ status: 'unchanged', ref: 'sk1' })
    // The files are on disk either way, so the caller is told where (M1).
    expect((again as { assetsDir?: string }).assetsDir).toMatch(
      /^\/data\/skills\/imported\/alpha-ticket-[0-9a-f]{8}$/,
    )
  })

  it('tags every created skill with the digest of its assembled body', async () => {
    const created: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          findByContentSha: () => null,
          writeAssets: (n) => `/data/skills/imported/${n}`,
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    const tag = created[0].capabilities.find((c: string) => c.startsWith('content-sha:'))
    expect(tag).toMatch(/^content-sha:[0-9a-f]{64}$/)
    // Recomputable from the stored body alone — no trimming rule to know.
    expect(tag.slice('content-sha:'.length)).toBe(
      createHash('sha256').update(created[0].content).digest('hex'),
    )
  })

  it('still falls back to the name lookup when no content lookup is wired', async () => {
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: () => {
            throw new Error('must not create')
          },
          findByName: () => ({
            id: 'sk0',
            content: assembleSkillContent(built.content, built.assets, '/data/skills/imported/x'),
          }),
          writeAssets: () => '/data/skills/imported/x',
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    expect(r).toEqual({
      status: 'unchanged',
      ref: 'sk0',
      importJobId: null,
      sha256: contentSha(assembleSkillContent(built.content, built.assets, '/data/skills/imported/x')),
      assetsSha256: packageDigest(built, built.assets),
      assetsDir: '/data/skills/imported/x',
    })
  })
})

describe('assembleSkillContent — deterministic order and safe clipping', () => {
  it('orders bundled files byte-wise, whatever order the caller passes them in', () => {
    // These two names sort in OPPOSITE orders under the two candidate rules, so
    // the assertion below distinguishes them rather than passing under either.
    //   \u{1F4C4} is U+1F4C4: UTF-16 lead unit 0xD83D, first UTF-8 byte 0xF0
    //   \uFF21    is U+FF21:  UTF-16 unit      0xFF21, first UTF-8 byte 0xEF
    // UTF-16 code-unit order puts the document emoji first; true byte order puts
    // the fullwidth letter first, which is what this implementation must do.
    const emoji = { relPath: '\u{1F4C4}.md', content: '# Doc' }
    const wide = { relPath: '\uFF21.md', content: '# Wide' }
    expect(emoji.relPath.charCodeAt(0)).toBeLessThan(wide.relPath.charCodeAt(0))
    expect(Buffer.from(wide.relPath, 'utf8')[0]).toBeLessThan(Buffer.from(emoji.relPath, 'utf8')[0])

    const forward = assembleSkillContent('# Body', [emoji, wide], null)
    const reversed = assembleSkillContent('# Body', [wide, emoji], null)
    expect(reversed).toBe(forward)
    expect(forward.indexOf(`### ${wide.relPath}`)).toBeLessThan(forward.indexOf(`### ${emoji.relPath}`))
  })

  it('orders plain ASCII paths ascending', () => {
    const assets = [
      { relPath: 'scripts/a.py', content: 'x = 1' },
      { relPath: 'references/r.md', content: '# Ref' },
      { relPath: 'assets/notes.md', content: '# Notes' },
    ]
    const forward = assembleSkillContent('# Body', assets, null)
    expect(assembleSkillContent('# Body', [...assets].reverse(), null)).toBe(forward)
    expect(forward.indexOf('### assets/notes.md')).toBeLessThan(forward.indexOf('### references/r.md'))
    expect(forward.indexOf('### references/r.md')).toBeLessThan(forward.indexOf('### scripts/a.py'))
  })

  it('does not mutate the caller’s asset array', () => {
    const assets = [
      { relPath: 'scripts/a.py', content: 'x = 1' },
      { relPath: 'assets/notes.md', content: '# Notes' },
    ]
    assembleSkillContent('# Body', assets, null)
    expect(assets.map((a) => a.relPath)).toEqual(['scripts/a.py', 'assets/notes.md'])
  })

  it('clips a huge asset by code point, never splitting a surrogate pair', () => {
    // One ASCII char then astral ones, so a UTF-16 slice at the cap lands on an
    // ODD index — in the middle of a surrogate pair.
    const text = `a${'\u{1F600}'.repeat(250_000)}`
    const c = assembleSkillContent('# Body', [{ relPath: 'data/big.txt', content: text }], null)
    expect(c).toContain('the complete file is data/big.txt')
    // A lone surrogate does not survive a UTF-8 round-trip; it comes back U+FFFD.
    expect(Buffer.from(c, 'utf8').toString('utf8') === c).toBe(true)
    expect(c.includes('\uFFFD')).toBe(false)
  })

  it('leaves an asset that is over the cap in UTF-16 units but under it in code points whole', () => {
    // 150k astral characters: 300k UTF-16 units, 150k code points. The cap is
    // about characters, so nothing is dropped.
    const text = '\u{1F600}'.repeat(150_000)
    const c = assembleSkillContent('# Body', [{ relPath: 'data/big.txt', content: text }], null)
    expect(c.includes('inline copy clipped')).toBe(false)
    expect(c.includes(text)).toBe(true)
  })
})

describe('applySkillItem — content-sha short-circuit', () => {
  const built = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }],
  })

  const run = async (findByContentSha: (sha: string) => { id: string } | null) => {
    let createCalls = 0
    const r = await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: () => {
            createCalls++
            return { id: 'sk-new' }
          },
          findByName: () => null,
          findByContentSha,
          writeAssets: (n) => `/data/skills/imported/${n}`,
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: built },
    )
    return { r, createCalls }
  }

  it('returns unchanged without creating anything when the content is already stored', async () => {
    const { r, createCalls } = await run(() => ({ id: 'sk-old' }))
    expect(r).toMatchObject({ status: 'unchanged', ref: 'sk-old' })
    expect((r as { assetsDir?: string }).assetsDir).toMatch(
      /^\/data\/skills\/imported\/alpha-ticket-[0-9a-f]{8}$/,
    )
    expect(createCalls).toBe(0)
  })

  it('behaves exactly as before when the content lookup finds nothing', async () => {
    const { r, createCalls } = await run(() => null)
    expect(r).toMatchObject({ status: 'applied', kind: 'skill', ref: 'sk-new' })
    expect(createCalls).toBe(1)
  })
})

describe('applySkillItem — R11 provenance, digests and the secrets tag', () => {
  const built = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }],
  })
  const job = { jobId: 'j1', sourceProfile: 'claude-code' as const }

  const store = (over: Record<string, unknown> = {}) => {
    const created: any[] = []
    const restamped: Array<{ id: string; input: any }> = []
    const deps: any = {
      createProposal: () => 'p',
      resolveDefaultAgentId: () => 'a',
      skills: {
        create: (i: any) => {
          created.push(i)
          return { id: 'sk-new' }
        },
        findByName: () => null,
        findByContentSha: () => null,
        restamp: (id: string, input: any) => restamped.push({ id, input }),
        writeAssets: (n: string) => `/data/skills/imported/${n}`,
        ...over,
      },
    }
    return { deps, created, restamped }
  }

  it('recognises a package imported before the amendment by its legacy digest', async () => {
    // P-13 — the pre-R11 assembly trimmed; the digest of that shape is the only
    // thing an already-imported package can be found by.
    const assetsDir = `/data/skills/imported/alpha-ticket-${packageDigest(built, built.assets).slice(0, 8)}`
    const legacySha = contentSha(assembleSkillContentLegacy(built.content, built.assets, assetsDir))
    const asked: string[] = []
    const { deps, created, restamped } = store({
      findByContentSha: (sha: string) => {
        asked.push(sha)
        // What the pre-amendment importer actually stored: the digest of the body
        // it assembled, which is also what proves the row is its own work.
        return sha === legacySha
          ? { id: 'sk-old', capabilities: ['imported', 'import-job:old', `content-sha:${legacySha}`] }
          : null
      },
      create: () => {
        throw new Error('must not create a second skill')
      },
    })

    const r = await applySkillItem(deps, { ...job, transformed: built })

    // The VERBATIM digest is asked for first, the legacy one only on a miss.
    expect(asked[0]).not.toBe(legacySha)
    expect(asked).toContain(legacySha)
    expect(created).toHaveLength(0)
    // A-24 — the stale body is re-stamped with the verbatim bytes.
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-old' })
    expect(restamped[0]).toMatchObject({ id: 'sk-old' })
    expect(restamped[0].input.sha).toBe(
      contentSha(assembleSkillContent(built.content, built.assets, assetsDir)),
    )
  })

  it('reports a legacy hit as unchanged, never a duplicate, when no re-stamp is wired', async () => {
    const assetsDir = `/data/skills/imported/alpha-ticket-${packageDigest(built, built.assets).slice(0, 8)}`
    const legacySha = contentSha(assembleSkillContentLegacy(built.content, built.assets, assetsDir))
    const { deps, created } = store({
      restamp: undefined,
      findByContentSha: (sha: string) =>
        sha === legacySha ? { id: 'sk-old', capabilities: ['import-job:old'] } : null,
      create: () => {
        throw new Error('must not create a second skill')
      },
    })
    const r = await applySkillItem(deps, { ...job, transformed: built })
    expect(r).toMatchObject({ status: 'unchanged', ref: 'sk-old', importJobId: 'old', sha256: legacySha })
    expect(created).toHaveLength(0)
  })

  it('tags a flagged package contains-secrets, writes its files and inlines them verbatim', async () => {
    // A-14 / P-3 — the credential-bearing file is bundled like any other; the
    // tag is what keeps the package out of recall.
    const flagged = buildSkillFromPackage({
      relativePath: '.claude/skills/alpha-ticket/SKILL.md',
      raw: SKILL,
      assets: [
        { relPath: 'scripts/fetch_ticket.py', content: 'x = 1' },
        { relPath: '.env', content: 'API_KEY=sk-abc123def456ghi789jkl012mno345\n', containsSecrets: true },
      ],
    })
    const written: any[] = []
    const { deps, created } = store({
      writeAssets: (n: string, a: any) => {
        written.push(a)
        return `/data/skills/imported/${n}`
      },
    })

    const r = await applySkillItem(deps, { ...job, transformed: flagged })

    expect(created[0].capabilities).toContain('contains-secrets')
    // Every file travelled, the flagged one included.
    expect(written[0].map((a: any) => a.relPath)).toEqual(['.env', 'scripts/fetch_ticket.py'])
    expect(created[0].content).toContain('API_KEY=sk-abc123def456ghi789jkl012mno345')
    expect(r).toMatchObject({
      status: 'applied',
      sha256: contentSha(created[0].content),
      assetsSha256: packageDigest(flagged, [
        { relPath: '.env', content: 'API_KEY=sk-abc123def456ghi789jkl012mno345\n', containsSecrets: true },
        { relPath: 'scripts/fetch_ticket.py', content: 'x = 1' },
      ]),
    })
  })

  it('flags a credential the scan never saw, past the head of the SKILL.md', async () => {
    // A-8 — the full-body recompute, over the assembled package.
    const long = buildSkillFromPackage({
      relativePath: '.claude/skills/beta/SKILL.md',
      raw: [
        '---',
        'name: beta',
        'description: does things',
        '---',
        '# Beta',
        'filler '.repeat(400),
        'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
        '',
      ].join('\n'),
      assets: [],
    })
    expect(long.containsSecrets).toBeUndefined()
    const { deps, created } = store()
    await applySkillItem(deps, { ...job, transformed: long })
    expect(created[0].capabilities).toContain('contains-secrets')
  })

  it('re-tags an already-stored package that is missing the secrets tag', async () => {
    // A-8b — `unchanged` would leave a credential in recall for ever.
    const assetsDir = `/data/skills/imported/alpha-ticket-${packageDigest(built, built.assets).slice(0, 8)}`
    const sha = contentSha(assembleSkillContent(built.content, built.assets, assetsDir))
    const flagged = { ...built, containsSecrets: true }
    const { deps, restamped } = store({
      findByContentSha: (asked: string) =>
        asked === sha ? { id: 'sk-old', capabilities: ['imported', 'import-job:old'] } : null,
      create: () => {
        throw new Error('must not create a second skill')
      },
    })
    const r = await applySkillItem(deps, { ...job, transformed: flagged })
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-old', sha256: sha })
    expect(restamped[0].input.addCapabilities).toContain('contains-secrets')
  })

  it('leaves an already-tagged package alone', async () => {
    const assetsDir = `/data/skills/imported/alpha-ticket-${packageDigest(built, built.assets).slice(0, 8)}`
    const sha = contentSha(assembleSkillContent(built.content, built.assets, assetsDir))
    const { deps, restamped } = store({
      findByContentSha: (asked: string) =>
        asked === sha ? { id: 'sk-old', capabilities: ['import-job:old', 'contains-secrets'] } : null,
      create: () => {
        throw new Error('must not create a second skill')
      },
    })
    const r = await applySkillItem(deps, { ...job, transformed: { ...built, containsSecrets: true } })
    expect(r).toMatchObject({ status: 'unchanged', ref: 'sk-old', importJobId: 'old', sha256: sha })
    expect(restamped).toHaveLength(0)
  })

  it('names the adapter that read the package, beside the job profile', async () => {
    const { deps, created } = store()
    await applySkillItem(deps, { ...job, adapterId: 'grok-cli', transformed: built })
    expect(created[0].capabilities).toEqual(
      expect.arrayContaining(['source:grok-cli', 'source-profile:claude-code', 'import-job:j1']),
    )
    // The job's own profile never becomes a second `source:` tag.
    expect(created[0].capabilities).not.toContain('source:claude-code')
  })

  it('lets a package declare contains-secrets about itself', async () => {
    // The one importer-read tag a source may set: it can only hide itself.
    const declaring = buildSkillFromPackage({
      relativePath: '.claude/skills/gamma/SKILL.md',
      raw: ['---', 'name: gamma', 'description: x', 'tags: [contains-secrets]', '---', '# Gamma'].join('\n'),
      assets: [],
    })
    const { deps, created } = store()
    await applySkillItem(deps, { ...job, transformed: declaring })
    expect(created[0].capabilities).toContain('contains-secrets')
  })
})

/**
 * Memory sovereignty under A-24, for skills. `findByName` answers with the
 * newest USER-owned skill of that name — which may be one the owner wrote
 * themselves, not an import's work.
 */
describe('applySkillItem — a skill the import never wrote', () => {
  const built = buildSkillFromPackage({
    relativePath: '.claude/skills/alpha-ticket/SKILL.md',
    raw: SKILL,
    assets: [],
  })
  const job = { jobId: 'j1', sourceProfile: 'claude-code' as const }

  /** The assembled body this package produces, and a whitespace-only variant of it. */
  const body = assembleSkillContent(built.content, [], null)
  const trimmedBody = body.trimEnd()

  const deps = (existing: { id: string; content: string; capabilities?: string[] } | null) => {
    const created: any[] = []
    const restamped: string[] = []
    return {
      created,
      restamped,
      deps: {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i: any) => {
            created.push(i)
            return { id: 'sk-new' }
          },
          findByName: () => existing,
          findByContentSha: () => null,
          restamp: (id: string) => restamped.push(id),
        },
      } as never,
    }
  }

  it('leaves a hand-written skill alone and creates the import beside it', async () => {
    // No `imported` capability and no `import-job:` — the owner's own skill.
    const { deps: d, created, restamped } = deps({
      id: 'sk-hand',
      content: trimmedBody,
      capabilities: ['mine'],
    })
    const r = await applySkillItem(d, { ...job, transformed: built })

    expect(restamped).toEqual([])
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-new' })
    expect(created[0].capabilities).toContain('conflict-with:sk-hand')
  })

  it('re-stamps the same skill once an import owns it', async () => {
    const { deps: d, created, restamped } = deps({
      id: 'sk-old',
      content: trimmedBody,
      capabilities: ['imported', 'import-job:old', `content-sha:${contentSha(trimmedBody)}`],
    })
    const r = await applySkillItem(d, { ...job, transformed: built })

    expect(created).toHaveLength(0)
    expect(restamped).toEqual(['sk-old'])
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-old', sha256: contentSha(body) })
  })

  it('accepts the ledger as provenance when the capabilities were edited away', async () => {
    const { deps: d, restamped } = deps({ id: 'sk-old', content: trimmedBody, capabilities: ['mine'] })
    const asked: Array<[string, string]> = []
    const r = await applySkillItem(
      { ...(d as any), wasImported: (kind: string, ref: string) => (asked.push([kind, ref]), ref === 'sk-old') },
      { ...job, transformed: built },
    )
    expect(asked).toContainEqual(['skill', 'sk-old'])
    expect(restamped).toEqual(['sk-old'])
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-old' })
  })

  it('reads a lone content-sha capability as provenance and re-stamps', async () => {
    // A package can never declare a reserved capability, so a stored skill
    // carrying one was stamped by an import — even when it is the only
    // importer-minted capability left on the row.
    const { deps: d, created, restamped } = deps({
      id: 'sk-old',
      content: trimmedBody,
      capabilities: ['content-sha:0000000000000000000000000000000000000000000000000000000000000000'],
    })
    const r = await applySkillItem(d, { ...job, transformed: built })

    expect(created).toHaveLength(0)
    expect(restamped).toEqual(['sk-old'])
    expect(r).toMatchObject({ status: 'applied', ref: 'sk-old', sha256: contentSha(body) })
  })

  describe('a capability that does not prove an import assembled the body', () => {
    // The skills module's own API passes `capabilities` through unfiltered
    // (`skills/routes.ts`), so a skill the owner made through the UI may
    // legitimately carry any of these. Only `content-sha:` is a witness.
    const notWitnesses = [
      ['ordinary words', ['deployment', 'alpha']],
      ['a source tag', ['source:my-team']],
      ['the same tag in another case', ['SOURCE:My-Team']],
      ['a source-changed marker', ['source-changed']],
      ['a conflict marker', ['conflict-with:x']],
      // These two behave like the tags witness for a note, but a skill is asked
      // about its capabilities alone — and the owner can type both.
      ['a bare imported tag', ['imported']],
      ['an import-job tag', ['import-job:old']],
      ['a content-sha that is not a digest', ['content-sha:not-a-digest']],
      // The real digest, uppercased. `digest('hex')` only ever produces
      // lowercase, so this was not written by the importer — and the refusal
      // side stays case-insensitive, which is why the witness may not be.
      ['an uppercase content-sha', [`content-sha:${contentSha(trimmedBody).toUpperCase()}`]],
    ] as const

    for (const [name, capabilities] of notWitnesses) {
      it(`leaves the owner's skill untouched for ${name}`, async () => {
        const { deps: d, created, restamped } = deps({
          id: 'sk-hand',
          content: trimmedBody,
          capabilities: [...capabilities],
        })
        const r = await applySkillItem(d, { ...job, transformed: built })

        expect(restamped).toEqual([])
        expect(r).toMatchObject({ status: 'applied', ref: 'sk-new' })
        expect(created[0].capabilities).toContain('conflict-with:sk-hand')
      })
    }
  })

  it('reports a byte-identical hand-written skill as unchanged, writing nothing', async () => {
    const { deps: d, created, restamped } = deps({ id: 'sk-hand', content: body, capabilities: ['mine'] })
    const r = await applySkillItem(d, { ...job, transformed: built })

    expect(created).toHaveLength(0)
    expect(restamped).toEqual([])
    expect(r).toMatchObject({ status: 'unchanged', ref: 'sk-hand', sha256: contentSha(body) })
  })
})

describe('applySkillItem — a credential the assembled body cannot show', () => {
  const job = { jobId: 'j1', sourceProfile: 'claude-code' as const }
  const run = async (assets: Array<{ relPath: string; content: string | Buffer; binary?: boolean }>) => {
    const created: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          findByContentSha: () => null,
          writeAssets: (n) => `/data/skills/imported/${n}`,
        },
      },
      {
        ...job,
        transformed: buildSkillFromPackage({
          relativePath: '.claude/skills/beta/SKILL.md',
          raw: ['---', 'name: beta', 'description: x', '---', '# Beta'].join('\n'),
          assets: assets as never,
        }),
      },
    )
    return created[0]
  }

  it('flags a credential past the inline clip of a bundled text file', async () => {
    // M-7 — the body inlines a text asset only up to MAX_INLINE_ASSET_CHARS, so
    // a pass over the assembled body alone cannot see this key.
    const tail = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY'
    const asset = 'a'.repeat(MAX_INLINE_ASSET_CHARS + 10) + '\n' + tail
    const created = await run([{ relPath: 'data/big.txt', content: asset }])
    expect(created.content).not.toContain(tail)
    expect(created.capabilities).toContain('contains-secrets')
  })

  it('flags a credential inside a binary asset, which is never inlined at all', async () => {
    const created = await run([
      { relPath: 'data/blob.bin', content: Buffer.from('API_KEY=sk-abc123def456ghi789jkl012mno345'), binary: true },
    ])
    expect(created.content).not.toContain('sk-abc123')
    expect(created.capabilities).toContain('contains-secrets')
  })
})

describe('inlineText — exact-limit astral text', () => {
  it('leaves a file of exactly the cap in astral characters untouched', () => {
    const text = '\u{1F600}'.repeat(MAX_INLINE_ASSET_CHARS)
    const c = assembleSkillContent('# Body', [{ relPath: 'data/big.txt', content: text }], null)
    expect(c.includes('inline copy clipped')).toBe(false)
    expect(c.includes(text)).toBe(true)
    // No half pair anywhere: a lone surrogate does not survive a UTF-8 round trip.
    expect(Buffer.from(c, 'utf8').toString('utf8') === c).toBe(true)
  })
})

describe('applySkillItem — a package cannot forge the importer’s own tags', () => {
  const withDeclaredTags = (tags: string[]) =>
    buildSkillFromPackage({
      relativePath: '.claude/skills/beta-tool/SKILL.md',
      raw: ['---', 'name: beta-tool', 'description: x', 'tags:', ...tags.map((t) => `  - "${t}"`), '---', '# Beta'].join(
        '\n',
      ),
      assets: [],
    })

  const store = () => {
    const byContentSha = new Map<string, string>()
    const created: any[] = []
    let n = 0
    return {
      created,
      deps: {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i: any) => {
            const id = `sk${++n}`
            created.push(i)
            // Exactly what Task 14 will do: index every capability that looks
            // like a content digest, declared or computed.
            for (const c of i.capabilities as string[]) {
              if (c.startsWith('content-sha:') && !byContentSha.has(c)) byContentSha.set(c, id)
            }
            return { id }
          },
          findByName: () => null,
          findByContentSha: (sha: string) => {
            const id = byContentSha.get(`content-sha:${sha}`)
            return id ? { id } : null
          },
        },
      },
    }
  }

  it('does not let a crafted content-sha suppress the genuine package’s import', async () => {
    const genuine = withDeclaredTags([])
    const s1 = store()
    await applySkillItem(s1.deps, { jobId: 'j1', sourceProfile: 'claude-code', transformed: genuine })
    const genuineSha = (s1.created[0].capabilities as string[])
      .find((c) => c.startsWith('content-sha:'))!
      .slice('content-sha:'.length)

    // A different package that declares the genuine one's digest as its own tag.
    const s2 = store()
    const evil = buildSkillFromPackage({
      relativePath: '.claude/skills/evil/SKILL.md',
      raw: ['---', 'name: evil', 'description: x', 'tags:', `  - "content-sha:${genuineSha}"`, '---', '# Evil'].join(
        '\n',
      ),
      assets: [],
    })
    const evilResult = await applySkillItem(s2.deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      transformed: evil,
    })
    expect(evilResult).toMatchObject({ status: 'applied', ref: 'sk1' })
    // The crafted tag is not stored, so it never claims the other digest.
    expect(s2.created[0].capabilities).not.toContain(`content-sha:${genuineSha}`)

    // The genuine package still imports afterwards instead of reporting unchanged.
    const genuineResult = await applySkillItem(s2.deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      transformed: genuine,
    })
    expect(genuineResult).toMatchObject({ status: 'applied', ref: 'sk2' })
  })

  it('strips every reserved provenance tag a source file declares, case-insensitively', async () => {
    const s = store()
    await applySkillItem(s.deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      transformed: withDeclaredTags([
        'imported',
        'source:hand-written',
        'import-job:someone-elses-job',
        'conflict-with:sk99',
        'source-changed',
        'skipped-unsafe-asset:7',
        'Content-Sha:deadbeef',
        'genuine-capability',
      ]),
    })
    const caps = s.created[0].capabilities as string[]
    expect(caps).toContain('genuine-capability')
    expect(caps).not.toContain('source:hand-written')
    expect(caps).not.toContain('import-job:someone-elses-job')
    expect(caps).not.toContain('conflict-with:sk99')
    expect(caps).not.toContain('skipped-unsafe-asset:7')
    expect(caps).not.toContain('Content-Sha:deadbeef')
    // The importer's own, computed versions are still there.
    expect(caps).toEqual(expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1']))
    expect(caps.filter((c) => c.startsWith('source:'))).toEqual(['source:claude-code'])
    expect(caps.filter((c) => c.startsWith('import-job:'))).toEqual(['import-job:j1'])
  })
})

describe('applySkillItem — asset path trimming and colons', () => {
  it('writes and inlines the trimmed path, not the padded one', async () => {
    const created: any[] = []
    const written: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          writeAssets: (n, a) => {
            written.push(a)
            return `/data/skills/imported/${n}`
          },
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        transformed: buildSkillFromPackage({
          relativePath: '.claude/skills/alpha-ticket/SKILL.md',
          raw: SKILL,
          assets: [{ relPath: '  scripts/a.py  ', content: 'x = 1' }],
        }),
      },
    )
    expect(written[0]).toEqual([{ relPath: 'scripts/a.py', content: 'x = 1' }])
    expect(created[0].content).toContain('### scripts/a.py')
    expect(created[0].content).not.toContain('###   scripts')
  })

  it('rejects a colon anywhere in the path, not only a leading drive letter', async () => {
    const created: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          writeAssets: (n, a) => `/data/skills/imported/${n}`,
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        transformed: buildSkillFromPackage({
          relativePath: '.claude/skills/alpha-ticket/SKILL.md',
          raw: SKILL,
          assets: [
            { relPath: 'notes.txt:hidden', content: 'ads' },
            { relPath: 'C:/windows/x.txt', content: 'w' },
            { relPath: 'scripts/ok.py', content: 'x = 1' },
          ],
        }),
      },
    )
    expect(created[0].capabilities).toContain('skipped-unsafe-asset:2')
    expect(created[0].content).toContain('### scripts/ok.py')
    expect(created[0].content).not.toContain('hidden')
  })
})

describe('applySkillItem — dropped capabilities are visible, not silent', () => {
  const pkg = (tags: string[]) =>
    buildSkillFromPackage({
      relativePath: '.claude/skills/beta-tool/SKILL.md',
      raw: ['---', 'name: beta-tool', 'description: x', 'tags:', ...tags.map((t) => `  - "${t}"`), '---', '# Beta'].join(
        '\n',
      ),
      assets: [],
    })

  const apply = async (tags: string[]) => {
    const created: any[] = []
    const warnings: any[] = []
    await applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        logger: { warn: (o) => warnings.push(o) },
        skills: {
          create: (i) => {
            created.push(i)
            return { id: 'sk1' }
          },
          findByName: () => null,
          findByContentSha: () => null,
        },
      },
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: pkg(tags) },
    )
    return { capabilities: created[0].capabilities as string[], warnings }
  }

  it('counts the reserved tags it dropped and warns once', async () => {
    const { capabilities, warnings } = await apply(['content-sha:x', 'source:internal', 'real-capability'])
    expect(capabilities).toContain('skipped-reserved-capability:2')
    expect(capabilities).toContain('real-capability')
    expect(capabilities).not.toContain('content-sha:x')
    expect(capabilities).not.toContain('source:internal')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      jobId: 'j1',
      skipped: 2,
      capabilities: ['content-sha:x', 'source:internal'],
    })
  })

  it('says nothing when a package declares no reserved tag', async () => {
    const { capabilities, warnings } = await apply(['real-capability'])
    expect(capabilities.some((c) => c.startsWith('skipped-reserved-capability:'))).toBe(false)
    expect(warnings).toEqual([])
  })

  it('does not let a package declare its own strip count', async () => {
    const { capabilities } = await apply(['skipped-reserved-capability:0', 'content-sha:x'])
    // Both were reserved, so the count the importer writes is the real one.
    expect(capabilities).toContain('skipped-reserved-capability:2')
    expect(capabilities).not.toContain('skipped-reserved-capability:0')
  })
})


/**
 * P1 / R1 — a skill row has columns for a handful of frontmatter keys and no
 * more. `allowed-tools`, `argument-hint`, `model`, `metadata` and whatever the
 * next assistant invents were read and then dropped: the SKILL.md itself is not
 * bundled as an asset, so nothing else carried them. They ride in the body now,
 * as an inert fenced block the owner can read.
 */
describe('skill package — frontmatter EYAS has no column for', () => {
  const build = (raw: string) =>
    buildSkillFromPackage({ relativePath: '.claude/skills/deploy/SKILL.md', raw, assets: [] })

  it('appends the unmapped keys as a fenced yaml block and leaves the body first', () => {
    const skill = build(
      [
        '---',
        'name: deploy',
        'description: Ship the docs',
        'allowed-tools: [Bash, Read]',
        'argument-hint: "<target>"',
        'model: some-model-id',
        '---',
        '# Deploy',
        '',
        'Run the build.',
        '',
      ].join('\n'),
    )
    expect(skill.name).toBe('deploy')
    expect(skill.description).toBe('Ship the docs')
    // The body is still the body, byte for byte, and comes first.
    expect(skill.content.startsWith('# Deploy\n\nRun the build.')).toBe(true)
    expect(skill.content).toContain('## Source frontmatter')
    expect(skill.content).toContain('allowed-tools:')
    expect(skill.content).toContain('argument-hint: <target>')
    expect(skill.content).toContain('model: some-model-id')
    // What EYAS DID map is not repeated in the block.
    const block = skill.content.slice(skill.content.indexOf('## Source frontmatter'))
    expect(block).not.toContain('description: Ship the docs')
  })

  it('adds nothing when every key the source declared has a column', () => {
    const skill = build(
      [
        '---',
        'name: deploy',
        'description: Ship the docs',
        'trigger_patterns: ["deploy docs"]',
        'capabilities: [docs]',
        '---',
        'Body only.',
        '',
      ].join('\n'),
    )
    expect(skill.content).toBe('Body only.\n')
    expect(skill.content).not.toContain('Source frontmatter')
  })

  it('adds nothing for a file with no frontmatter at all', () => {
    expect(build('# Just a heading\n\nAnd a body.\n').content).toBe('# Just a heading\n\nAnd a body.\n')
  })

  it('keeps a nested metadata object rather than flattening it away', () => {
    const skill = build(
      ['---', 'name: deploy', 'metadata:', '  owner: alpha', '  tier: 2', '---', 'Body.', ''].join('\n'),
    )
    expect(skill.content).toContain('metadata:')
    expect(skill.content).toContain('owner: alpha')
    expect(skill.content).toContain('tier: 2')
  })

  it('opens a fence long enough to hold a value that contains backticks', () => {
    const skill = build(
      ['---', 'name: deploy', 'note: "a ``` fence inside"', '---', 'Body.', ''].join('\n'),
    )
    // A three-backtick fence would be closed early by the value itself.
    expect(skill.content).toContain('````yaml')
    expect(skill.content.trimEnd().endsWith('````')).toBe(true)
  })

  it('carries the block through into the content that is actually stored', () => {
    const created: Array<Record<string, unknown>> = []
    const skill = build(
      ['---', 'name: deploy', 'model: some-model-id', '---', 'Body.', ''].join('\n'),
    )
    return applySkillItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        skills: {
          create: (input: Record<string, unknown>) => {
            created.push(input)
            return { id: 'sk1' }
          },
          findByName: () => null,
          findByContentSha: () => null,
        },
      } as never,
      { jobId: 'j1', sourceProfile: 'claude-code', transformed: skill },
    ).then(() => {
      expect(String(created[0]!.content)).toContain('## Source frontmatter')
      expect(String(created[0]!.content)).toContain('model: some-model-id')
    })
  })
})
