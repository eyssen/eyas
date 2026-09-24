// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  classifyPath,
  detectProfileFromPaths,
  looksLikeSecrets,
  rootMarkerPrefix,
  titleFromPathAndContent,
} from '@modules/data-port/scanners/heuristics'

describe('data-port heuristics', () => {
  it('detects claude-code from a root CLAUDE.md or .claude/', () => {
    expect(detectProfileFromPaths(['CLAUDE.md', 'skills/foo.md'])).toBe('claude-code')
    expect(detectProfileFromPaths(['.claude/settings.json', 'notes/a.md'])).toBe('claude-code')
  })

  it('does not treat a nested checkout CLAUDE.md as the whole tree being claude-code', () => {
    expect(detectProfileFromPaths(['GitHub/alpha/CLAUDE.md', 'GitHub/alpha/README.md'])).toBe('generic-md')
  })

  it('detects cursor from .cursorrules', () => {
    expect(detectProfileFromPaths(['.cursorrules', 'src/main.ts'])).toBe('cursor')
  })

  it('detects obsidian from .obsidian folder', () => {
    expect(detectProfileFromPaths(['.obsidian/app.json', 'Notes/foo.md'])).toBe('obsidian')
  })

  it('classifies CLAUDE.md as workspace rules', () => {
    const h = classifyPath('CLAUDE.md', '# Rules\nAlways use TypeScript')
    expect(h.kind).toBe('rule')
    expect(h.target).toBe('workspace.agents')
    expect(h.selectedByDefault).toBe(true)
  })

  it('classifies skill.md under skills/', () => {
    const h = classifyPath(
      'skills/coding/review.md',
      '---\nname: review\ntrigger_patterns: ["review"]\n---\n# Review skill',
    )
    expect(h.kind).toBe('skill')
    expect(h.target).toBe('skill')
  })

  it('imports MEMORY.md as one index unit and never drops a bullet-heavy note', () => {
    const idx = classifyPath(
      '.grok/memory/MEMORY.md',
      '# Memory\n- [a](a.md)\n- [b](b.md)\n- [c](c.md)\n- [d](d.md)\n',
      'claude-code',
    )
    expect(idx.kind).toBe('index')
    expect(idx.target).toBe('vault.semantic')
    const note = classifyPath(
      'ai-memory/feedback_alpha_rule.md',
      '---\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n',
      'claude-code',
    )
    expect(note.kind).toBe('memory')
  })

  it('imports a durable note under an assistant memory path', () => {
    const h = classifyPath(
      '.grok/memory/alpha-pref.md',
      '---\nname: pref\ndescription: how to work\ntype: feedback\n---\nPrefer concise answers.\n',
    )
    expect(h.kind).toBe('memory')
    expect(h.selectedByDefault).toBe(true)
  })

  it('does not treat config/skills in a product checkout as importable skills', () => {
    const h = classifyPath(
      'GitHub/alpha/config/skills/demo.md',
      '---\nname: demo\ntrigger_patterns: ["demo"]\n---\n# Demo\n',
    )
    expect(h.kind).not.toBe('skill')
  })

  it('does not treat vault memory frontmatter as skill', () => {
    const h = classifyPath(
      'ai-memory/feedback_always_check_memory.md',
      '---\nname: Always check memory\ndescription: do not wait for explicit triggers\ntype: feedback\n---\nBody\n',
    )
    expect(h.kind).toBe('memory')
    expect(h.target).not.toBe('skill')
  })

  it('does not flag prose mentioning secret/password', () => {
    const h = classifyPath(
      'ai-memory/project_security_note.md',
      '---\nname: sec\ndescription: gate secrets\ntype: project\n---\nDiscussed password policy and secret handling.\n',
    )
    expect(h.kind).toBe('memory')
    expect(h.tags ?? []).not.toContain('contains-secrets')
  })

  it('extracts title from h1', () => {
    expect(titleFromPathAndContent('notes/x.md', '# Hello World\n\nbody')).toBe('Hello World')
  })
})

describe('generic markdown and vault picks', () => {
  const DECLARED = '---\ntype: feedback\n---\nThe owner prefers short answers.\n'
  const PLAIN = '# Plain note\nA note long enough to be worth a row ticked in advance for the owner.\n'

  it('imports declared and plain notes under the plain-markdown pick', () => {
    expect(classifyPath('notes/declared.md', DECLARED, 'generic-md')).toMatchObject({
      kind: 'memory',
      target: 'vault.semantic',
      reasonCode: 'memory-note',
      selectedByDefault: true,
    })
    expect(classifyPath('notes/plain.md', PLAIN, 'generic-md').kind).toBe('memory')
  })

  it('imports a declared note under the Obsidian pick, which used to junk it', () => {
    expect(classifyPath('notes/declared.md', DECLARED, 'obsidian')).toMatchObject({
      kind: 'memory',
      selectedByDefault: true,
    })
  })

  it('routes a how-to under either pick to the procedural tier', () => {
    const raw = '# Runbook\nHow to restore the service, step by step.\n'
    expect(classifyPath('notes/runbook.md', raw, 'generic-md').target).toBe('vault.procedural')
    expect(classifyPath('notes/runbook.md', raw, 'obsidian').target).toBe('vault.procedural')
  })
})

describe('looksLikeSecrets (R11.4 heuristic fix)', () => {
  it('does not flag code that looks a secret up', () => {
    for (const line of [
      'TOKEN = keychain_lookup("alpha")', 'API_KEY = os.environ["ALPHA_KEY"]', 'password = getenv("ALPHA_PW")',
      'const apiKey = process.env.ALPHA_API_KEY', 'API_KEY=process.env.ALPHA_API_KEY',
      'TOKEN=$(security find-generic-password -s alpha -w)', 'TOKEN=${ALPHA_TOKEN}', 'SECRET=config.secrets.alpha',
    ]) expect(looksLikeSecrets('a/fetch.py', line)).toBe(false)
  })
  it('does not flag documentation placeholders', () => {
    for (const line of [
      'API_KEY=<your-api-key>', 'PASSWORD="your-password-here"', 'TOKEN=xxxxxxxxxxxxxxxxxxxx',
      'OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx', 'API_KEY=************', 'SECRET=...', 'TOKEN=changeme-changeme',
    ]) expect(looksLikeSecrets('README.md', line)).toBe(false)
  })
  it('still flags a literal credential', () => {
    for (const line of [
      'API_KEY=alphabravo0123456789', "export TOKEN='alpha.bravo.charlie.delta0'", 'DB_PASSWORD=alphaalphaalpha0001',
      'ghp_alphaalphaalphaalphaalpha01', 'sk-alpha_bravo-charlie0123456789', 'AKIAALPHABRAVO123456',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    ]) expect(looksLikeSecrets('notes.md', line)).toBe(true)
  })
  it('names templates as documentation and env files as credentials', () => {
    for (const f of ['.env.example', '.env.sample', 'a/.env.template', 'environment.md']) expect(looksLikeSecrets(f, '')).toBe(false)
    for (const f of ['.env', '.env.local', 'alpha.env', 'id_rsa', 'server.pem']) expect(looksLikeSecrets(f, '')).toBe(true)
  })
  it('reads a credential in dotenv, YAML, TOML and JSON shapes, whatever the case', () => {
    for (const line of [
      'password = "alphabravo0123456789"', 'token: alphabravo0123456789',
      '{"api_key": "alphabravo0123456789"}', "DB_PASSWORD='alphabravo0123456789'",
      'secret_key : alphabravo0123456789', 'X-API-Key: alphabravo0123456789',
      'access_token = alphabravo0123456789', 'api_key: "dGhpc2lzYW5hbHBoYXZhbHVl"',
    ]) expect(looksLikeSecrets('a/config.yaml', line)).toBe(true)
  })
  it('keeps every lookup and placeholder shape false after the key side widened', () => {
    for (const line of [
      'TOKEN = keychain_lookup("alpha")', 'password = keychain_lookup("alpha/bravo")',
      'API_KEY = os.environ["ALPHA_KEY"]', 'password = getenv("ALPHA_PW")',
      'const apiKey = process.env.ALPHA_API_KEY', 'API_KEY=process.env.ALPHA_API_KEY',
      'TOKEN=$(security find-generic-password -s alpha -w)', 'TOKEN=${ALPHA_TOKEN}',
      'SECRET=config.secrets.alpha', 'API_KEY = "your-key-here"', 'API_KEY=<your-api-key>',
      'PASSWORD="your-password-here"', 'password: !vault |',
    ]) expect(looksLikeSecrets('a/fetch.py', line)).toBe(false)
  })
  it('reads property access, operators and type syntax as code, not as a credential', () => {
    for (const line of [
      'max_tokens: request.maxTokens || 4096', 'budget_tokens: req.thinking.budgetTokens ?? 8000',
      'token: data.accessToken', "secrets: Pick<SecretsRegistry, 'get'>",
      'prompt_tokens: usage.promptTokens', 'tokens: event.tokensUsed',
      'password: Record<string, string>', 'token: ${ALPHA_SERVICE_TOKEN}',
      'secrets: data?.secrets', 'api_keys: options?.apiKeys',
      'api_key: `${base}/alpha/bravo`',
    ]) expect(looksLikeSecrets('n.md', line)).toBe(false)
    // A dotted chain is code only without a digit — this one is the credential the brief requires flagged.
    expect(looksLikeSecrets('n.md', "export TOKEN='alpha.bravo.charlie.delta0'")).toBe(true)
  })
  it('reads a location, a bare identifier and a repeated key name as anything but a credential', () => {
    for (const line of [
      // A path or a URL is where a credential lives, not the credential.
      'POSTGRES_PASSWORD_FILE = /run/secrets/db_password',
      'GMAIL_OAUTH_TOKEN_URL = https://oauth2.googleapis.com/token',
      'token_path = ./config/alpha/token', 'secret_file = ~/alpha/bravo/secret',
      // A deployment template telling the operator to substitute.
      'ANTHROPIC_API_KEY = REPLACE_WITH_BASE64_ENCODED_KEY',
      // A bare identifier: a type, a class or a variable, never a generated credential.
      'secrets = SecretsRegistry', 'secrets = SecretManager', 'secrets = secretsPlaceholder',
      'tokens = TokenManager', 'refresh_token = refreshToken', 'tokens = resultTokens',
      'tokens = outputTokens', 'tokens = tokenBundleValue',
      // A URL naming an endpoint carries nothing; only the endpoint is the value.
      'token: https://alpha.internal/docs/page',
      // A-21 / R-1: a bare anchor is a heading, not a credential — a fragment is
      // only read where it has the `name=value` shape a token arrives in.
      'token: https://alpha.internal/docs/page#api-key-rotation',
      'secret: https://alpha.internal/docs/guide#section-4',
      // The value repeats its key, or is a bare credential noun.
      'tokens_used_month = tokens_used_month', 'service_password: service_password', 'secret: apikey',
    ]) expect(looksLikeSecrets('n.md', line)).toBe(false)
    // The carve-out: a URL whose authority carries a password IS a credential.
    expect(looksLikeSecrets('n.md', 'password: postgres://alpha:bravocharlie0123@host/db')).toBe(true)
    // A hyphenated value with no digit is still a credential shape, not a name.
    expect(looksLikeSecrets('n.md', 'APP_SECRET = super-secret-app-secret')).toBe(true)
    expect(looksLikeSecrets('n.md', 'refresh_token = LEAKED-VALUE')).toBe(true)
  })
  it('flags a credential a URL carries, an unhyphenated passphrase and a base64 blob behind a slash', () => {
    for (const line of [
      // I-3: a URL is a location only while it carries nothing credential-shaped.
      'token: https://hooks.alpha.internal/services/T012ABCDEF/B034GHIJKL/aBcDeFgHiJkLmNoPqRsTuVwX',
      'api_key: https://alpha.internal/v1?api_key=alphabravocharlie0123456',
      'secret: https://alpha.s3.internal/f?X-Amz-Signature=abc123def456abc123def456',
      // A-21 / R-1: OAuth's implicit flow hands the live token back after the
      // `#`, so a redirect URI pasted into a note is a credential in the half a
      // query-only scan never examined — by parameter NAME and by entropy.
      'token: https://alpha.internal/cb#access_token=yaBravoCharlie0123456789&token_type=Bearer',
      'secret: https://alpha.internal/cb#state=x&id_token=aBcDeFgH01234567IjKlMn',
      'API_TOKEN = https://alphabravocharlie0123@alpha.internal/a/b.git',
      'password: postgres://alpha:bravocharlie0123@host/db', 'password: redis://:passbravo0123@host',
      // I-4: an all-lowercase run of letters is the canonical passphrase, not an identifier.
      'password: correcthorsebatterystaple', 'password: mysupersecretpassphrase',
      'passphrase_token: opensesameopensesame', 'password: hunterhunterhunter',
      'password: correct-horse-battery-staple',
      // M-5: `/` opens roughly one base64 value in 64; that is not a path.
      'password: /YW5hbHBoYXZhbHVlMDEyMzQ1Njc4OQ==', 'password: /9j8Hs2kLmNpQrStUvWxYz0123456ab',
    ]) expect(looksLikeSecrets('n.md', line)).toBe(true)
  })
  it('leaves prose and base64 alone, and reads a key block as a key', () => {
    expect(looksLikeSecrets('notes/a.md', 'Rotate the password before the audit, then tell the team.')).toBe(false)
    expect(looksLikeSecrets('notes/a.md', 'Password: see the shared vault entry.')).toBe(false)
    expect(looksLikeSecrets('notes/a.md', '**Token policy:** rotate every quarter.')).toBe(false)
    expect(looksLikeSecrets('notes/a.md', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQ==')).toBe(false)
    expect(looksLikeSecrets('notes/a.md', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----')).toBe(true)
  })
  it('names a secret by its name or content, however far into the file it sits', () => {
    expect(looksLikeSecrets('a/credentials.json', '{}')).toBe(true)
    expect(looksLikeSecrets('a/notes.md', 'x'.repeat(9000) + '\nAPI_KEY=alphaalphaalpha0001\n')).toBe(true)
    expect(looksLikeSecrets('a/k.txt', '-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
    expect(looksLikeSecrets('a/k.txt', 'token ghp_alphaalphaalphaalphaalpha01 here')).toBe(true)
  })
  it('does not call prose about passwords a secret', () => {
    expect(looksLikeSecrets('ai-memory/note.md', 'Discussed the password policy and secret handling.')).toBe(false)
  })
})

describe('classifyPath defaults (R11.3, D-8)', () => {
  it('never gives a text file target none', () => {
    for (const f of ['a.log', 'a.csv', 'a.tsv', 'a.map', 'a.min.js', 'a.pem', 'a.sh', 'a.py', 'a.yaml', 'a.toml', 'a.ts']) {
      const h = classifyPath(`alpha/${f}`, 'text\n')
      expect(h.target).not.toBe('none'); expect(h.kind).not.toBe('noise')
    }
    expect(classifyPath('alpha/bun.lock', '{}').reasonCode).toBe('derived-index')
    expect(classifyPath('alpha/a.png', '').reasonCode).toBe('binary')
  })
  it('lists source code importable but unticked, data files likewise', () => {
    expect(classifyPath('GitHub/alpha/src/main.ts', 'export {}')).toMatchObject({ kind: 'code', target: 'vault.semantic', reasonCode: 'source-code', selectedByDefault: false })
    expect(classifyPath('a/b.yaml', 'a: 1')).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false })
    expect(classifyPath('.claude/settings.json', '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', target: 'vault.semantic', selectedByDefault: false })
    expect(classifyPath('.grok/relocations/r1.json', '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
  })
  it('flags secrets and keeps the real kind', () => {
    expect(classifyPath('.env', 'API_KEY=alphabravo0123456789')).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false, tags: ['contains-secrets'] })
    expect(classifyPath('ai-memory/note.md', '---\ntype: project\n---\nAPI_KEY=alphabravo0123456789', 'claude-code')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['contains-secrets'] })
  })
  it('selects session notes of both classes', () => {
    expect(classifyPath('vault/claude-sessions/2026-08/x.md', '---\ntype: claude-session\n---\nlog', 'obsidian')).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'session-summary', selectedByDefault: true })
    expect(classifyPath('notes/x.md', '---\ntype: grok-session\n---\nlog')).toMatchObject({ kind: 'session', selectedByDefault: true })
    expect(classifyPath('vault/claude-sessions/claude-sessions.md', '---\ntype: moc\n---\n# index').kind).not.toBe('session')
  })
  it('imports rule files anywhere as proposals', () => {
    for (const f of ['GitHub/alpha/AGENTS.md', 'GitHub/alpha/CLAUDE.md', 'GitHub/alpha/GEMINI.md', 'GitHub/alpha/.cursorrules', 'GitHub/alpha/.windsurf/rules/global_rules.md'])
      expect(classifyPath(f, '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file', selectedByDefault: true })
    expect(classifyPath('GitHub/alpha/.cursor/rules/py.mdc', '# py')).toMatchObject({ kind: 'rule' })
    expect(classifyPath('GitHub/alpha/.claude/rules/style.md', '# style')).toMatchObject({ kind: 'rule' })
    expect(classifyPath('alpha/rules/data.csv', 'a,b').kind).not.toBe('rule')
    // A vault folder that happens to be called `rules` holds notes, not agent rules (only assistant rule dirs and `.mdc` count).
    expect(classifyPath('Areas/rules/style.md', '# house style')).toMatchObject({ kind: 'memory' })
    expect(classifyPath('GitHub/alpha/docs/tools.md', '# tools')).toMatchObject({
      kind: 'knowledge',
      selectedByDefault: false,
    })
  })
  it('lists Obsidian configuration as importable config, unticked, never as app-state', () => {
    for (const f of ['Documents/Vault/.obsidian/app.json', 'Documents/Vault/.obsidian/workspace.json', 'Documents/Vault/.obsidian/plugins/alpha/data.json', 'Documents/Vault/.obsidian/snippets/theme.css'])
      expect(classifyPath(f, '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', target: 'vault.semantic', selectedByDefault: false })
  })
  it('imports any markdown under any profile and labels third-party and legacy', () => {
    expect(classifyPath('docs/howto.md', '# How to ship', 'claude-code')).toMatchObject({ kind: 'memory', target: 'vault.procedural', selectedByDefault: true })
    expect(classifyPath('notes/short.md', '# hi\n', 'generic-md').selectedByDefault).toBe(true)
    expect(classifyPath('.grok/docs/user-guide/13-memory.md', '# Cross-Session Memory')).toMatchObject({
      kind: 'knowledge',
      selectedByDefault: false,
      tags: ['third-party'],
    })
    expect(classifyPath('GitHub/flutter/docs/howto.md', '# how to')).toMatchObject({
      kind: 'knowledge',
      selectedByDefault: false,
    })
    expect(classifyPath('shop/robots.txt', 'User-agent: *')).toMatchObject({
      kind: 'knowledge',
      reasonCode: 'not-durable',
      selectedByDefault: false,
    })
    for (const f of ['.claude/projects/alpha/memory.local-backup-2026-05-09/project_x.md', 'vault/ai-memory/memory.old/x.md', 'notes/x.md.bak'])
      expect(classifyPath(f, 'body', 'claude-code')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['legacy'] })
  })

  it('does not select package caches, Photos libraries, CLA trees or session-stats by default', () => {
    expect(classifyPath(
      'Pictures/Photos Library.photoslibrary/database/search/a.txt',
      'spotlight blob',
    )).toMatchObject({ selectedByDefault: false })
    expect(classifyPath('.claude/session-stats/abc.statusline.txt', 'tokens=1')).toMatchObject({
      selectedByDefault: false,
    })
    expect(classifyPath('GitHub/odoo/odoo-odoo-18/doc/cla/individual/x.md', 'I agree')).toMatchObject({
      selectedByDefault: false,
    })
    expect(classifyPath('GitHub/eyas/.superpowers/sdd/final-fixes-report.md', '# report')).toMatchObject({
      selectedByDefault: false,
    })
    expect(classifyPath('eyas-memory-backup-20260908-083518/vault/semantic/x.md', '# old')).toMatchObject({
      selectedByDefault: false,
    })
    expect(classifyPath('README.md', '# Hello')).toMatchObject({ selectedByDefault: false, reasonCode: 'not-durable' })
    // Owner memory stays ticked.
    expect(classifyPath('.grok/memory/feedback_alpha.md', '---\ntype: feedback\n---\nPrefer X.')).toMatchObject({
      kind: 'memory',
      selectedByDefault: true,
    })
    expect(classifyPath('Documents/Obsidian Vault/10_Projects/alpha.md', '# project')).toMatchObject({
      kind: 'memory',
      selectedByDefault: true,
    })
  })
  it('anchors the dependency/vcs path rule on a real segment', () => {
    expect(classifyPath('alpha.git/notes.md', '# n').kind).toBe('memory')
    expect(classifyPath('alpha/.github/x.md', '# n').kind).toBe('memory')
    expect(classifyPath('alpha/.git/HEAD', 'ref: x')).toMatchObject({ kind: 'knowledge', reasonCode: 'unrecognised', selectedByDefault: false })
  })
})

describe('rootMarkerPrefix', () => {
  it('returns the marker chain of a root inside an assistant tree', () => {
    expect(rootMarkerPrefix('/home/alpha/.claude')).toBe('.claude')
    expect(rootMarkerPrefix('/home/alpha/.claude/projects/bravo/memory')).toBe('.claude/projects/bravo/memory')
    expect(rootMarkerPrefix('/home/alpha/.grok/memory')).toBe('.grok/memory')
    expect(rootMarkerPrefix('/home/alpha/Documents/Vault/ai-memory')).toBe('ai-memory')
  })

  it('is empty for a root that names no assistant tree', () => {
    expect(rootMarkerPrefix('/home/alpha/notes')).toBe('')
    expect(rootMarkerPrefix('/home/alpha/Documents/Vault')).toBe('')
  })
})
