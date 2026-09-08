// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SourceProfile } from '../types.js'
import type { AdapterHint } from '../adapters/types.js'
import { splitFrontmatter } from '../source-frontmatter.js'

/** The base, provider-agnostic hint. Same shape as an adapter hint. */
export type HeuristicHint = AdapterHint

/** Dot-directories an assistant owns; used to scope config detection. */
const ASSISTANT_DOT_DIRS = [
  '.claude',
  '.grok',
  '.agents',
  '.cursor',
  '.codex',
  '.gemini',
  '.codeium',
  '.windsurf',
  '.github',
  '.obsidian',
]

/** The one path normaliser every reading path shares: separators and case. */
export function posix(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').toLowerCase()
}

/**
 * Directory names that make a path self-describing: whatever the scan is rooted
 * at, a path holding one of these segments names an assistant's own tree or a
 * memory folder. Deliberately narrow — a segment common enough to name an
 * ordinary folder (`vault`, `memory`, `notes`) would put a marker in front of
 * paths that never had one, and a file at the top of such a root would stop
 * being a root-level file.
 */
const MARKER_SEGMENTS = new Set([...ASSISTANT_DOT_DIRS, 'ai-memory', 'claude-sessions'])

/**
 * A scan rooted INSIDE an assistant tree (`~/.claude`, `~/.grok/memory`,
 * `<vault>/ai-memory`) hands the classifier paths with the marker segment cut
 * off, so every rule that recognises durable content by where it lives stops
 * matching and the whole tree arrives with a weaker kind. This returns the
 * marker chain of the root — `.claude/projects/alpha/memory` for a scan rooted
 * there — so the classifier can be shown the path a scan of the parent would
 * have produced. Empty when the root names no marker: an arbitrary folder keeps
 * its root-relative paths, and a file at its top stays a root-level file.
 */
export function rootMarkerPrefix(rootPath: string): string {
  const segments = posix(rootPath).split('/').filter(Boolean)
  const at = segments.findIndex((s) => MARKER_SEGMENTS.has(s))
  return at < 0 ? '' : segments.slice(at).join('/')
}

/**
 * The path already names an assistant's own tree. A profile pick is a claim on
 * an *unmarked* tree only — it must never relabel files that say whose they are.
 */
export function hasAssistantMarker(relativePath: string): boolean {
  const p = posix(relativePath)
  return isAssistantDotDirPath(relativePath) || p === 'ai-memory' || p.startsWith('ai-memory/') || p.includes('/ai-memory/')
}

/** Assistant / vault trees the importer treats as memory by where they live. */
export function isDurableMemoryPath(relativePath: string): boolean {
  const p = posix(relativePath)
  if (/(^|\/)eyas-memory-backup/.test(p)) return false
  return (
    p.includes('ai-memory/') ||
    p.includes('.grok/memory/') ||
    p.includes('/.claude/memory/') ||
    p.startsWith('.claude/memory/') ||
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

/**
 * Anchored on a real path segment: `xyz.claude/` is not `.claude/`. Unlike
 * `isAssistantWorkspacePath` a bare root-level file is NOT "under an assistant
 * dir" — an uploaded `settings.json` is not automatically an assistant's.
 */
export function isAssistantDotDirPath(relativePath: string): boolean {
  const p = posix(relativePath)
  return ASSISTANT_DOT_DIRS.some((d) => p.startsWith(`${d}/`) || p.includes(`/${d}/`))
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

/** Only a file literally named MEMORY.md is an index. Bullet-heavy notes are notes. */
export function isMemoryIndexFile(relativePath: string, _content: string): boolean {
  const base = posix(relativePath).split('/').pop() ?? ''
  return base === 'memory.md'
}

/** Full TUI/chat session transcripts — routed to episodic, never dropped. */
export function isSessionDumpPath(relativePath: string): boolean {
  return posix(relativePath).includes('claude-sessions/')
}

/** `.env.example` / `.env.sample` / `.env.template` / `.env.dist` are documentation, not credentials. */
const SECRET_NAME_TEMPLATES = /\.env\.(example|sample|template|dist)$/

/** A value that documents a secret instead of being one. */
function isSecretPlaceholder(value: string): boolean {
  const v = value.trim()
  if (/^<[^>]*>$/.test(v)) return true
  if (/^(\.{3,}|…+)$/.test(v)) return true
  if (/^(.)\1{7,}$/.test(v)) return true
  if (/(x{6,}|X{6,}|\*{4,})/.test(v)) return true
  if (/^['"]?(your|my|the|an?)[-_ ]/i.test(v)) return true
  if (/\b(your[-_]?|example|sample|dummy|placeholder|changeme|change[-_]me|redacted|todo|fixme)\b/i.test(v)) return true
  // A deployment template telling the operator to substitute a real value.
  if (/\breplace[-_]?with/i.test(v)) return true
  return false
}

/**
 * Code that LOOKS UP or DESCRIBES a credential instead of being one: a call, a
 * subscript, a substitution, an operator or type expression, a known env/config
 * accessor chain, or a plain property read.
 *
 * The property read needs a discriminator, because `alpha.bravo.charlie.delta0`
 * is a credential this heuristic must flag while `request.maxTokens` is a field
 * access it must not. A digit separates the two: a dotted chain of bare
 * identifiers with no digit anywhere is code — `request.maxTokens`,
 * `req.thinking.budgetTokens`, `data?.secrets`, `event.tokensUsed` — while a
 * generated credential carries digits. Testing for the chain alone would clear
 * the required-true value above, so both halves are required. The chain is
 * anchored on the whole value, so a password that merely contains a dot stays
 * flagged.
 */
function isLookupExpression(value: string): boolean {
  const v = value.trim()
  // Structural code punctuation: a call, a subscript, a substitution, `||` / `??`,
  // or a type parameter (`Pick<SecretsRegistry, 'get'>`). `,`, `]` and `}` cannot
  // reach here through CREDENTIAL_ASSIGNMENT, whose value stops at them; they are
  // listed so the predicate is correct for any caller.
  if (/\|\||\?\?|[()\[\]{}<>,$`]/.test(v)) return true
  if (/^(process\.env|os\.environ|os\.getenv|environ|env|ENV|Deno\.env|import\.meta\.env|System\.getenv|config|settings|secrets|vault|keychain|this|self|ctx|deps)\b/i.test(v)) return true
  // Both remaining shapes are code only when no digit appears: a generated
  // credential carries digits, which is what keeps the required-true
  // `alpha.bravo.charlie.delta0` flagged while clearing `request.maxTokens`.
  if (/\d/.test(v)) return false
  // A bare identifier, and only when an internal capital makes it camelCase or
  // PascalCase — `accessToken`, `SecretsRegistry`. An all-lowercase run of
  // letters is the canonical passphrase shape (`correcthorsebatterystaple`), so
  // it stays a credential (I-4).
  if (/^[A-Za-z$]+$/.test(v) && /[a-z][A-Z]/.test(v)) return true
  // A dotted accessor chain, optional chaining included.
  return /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/.test(v)
}

const PRIVATE_KEY_BLOCK = /BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY/i
const PROVIDER_TOKEN = /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g
// NAME=value / NAME: value / "name": "value" where NAME names a credential. The
// key side is case-insensitive and format-agnostic on purpose: dotenv, YAML,
// TOML, JSON and a line pasted into a note all carry the same credential, and a
// key that only `.env` spelling would catch let real credentials through
// untagged. The keyword must be a whole `_`/`-` delimited segment, so `Secretary`
// and `tokenizer` are words, not keys. Judging what was matched is left entirely
// to the value side: `isLookupExpression` clears code that READS a credential and
// `isSecretPlaceholder` clears documentation, which is why widening the key side
// costs no precision. Group 3 is the value; it stops at a quote, whitespace or a
// YAML/JSON terminator so the captured text is the value and nothing else.
const CREDENTIAL_ASSIGNMENT =
  /(?:^|[\s{,[])["']?((?:[A-Za-z0-9]+[_-])*(?:api[_-]?keys?|secrets?|passwords?|passwd|tokens?)(?:[_-][A-Za-z0-9]+)*)["']?[ \t]*[:=][ \t]*(['"]?)([^'"\s,}\]]{12,})\2/gim

/**
 * 16 or more characters that read as generated rather than written: letters with
 * digits, or mixed case. The same shape the value side already treats as a
 * credential, reused to judge what a URL is carrying.
 */
function isHighEntropyToken(s: string): boolean {
  if (s.length < 16 || !/^[A-Za-z0-9_-]+$/.test(s)) return false
  return (/[A-Za-z]/.test(s) && /\d/.test(s)) || (/[a-z]/.test(s) && /[A-Z]/.test(s))
}

/** Query-parameter names that carry a credential instead of describing an endpoint. */
const CREDENTIAL_PARAM_WORDS = new Set(['token', 'key', 'apikey', 'accesstoken', 'sig', 'signature', 'password', 'passwd', 'secret'])

/**
 * A base64 blob wearing a path's clothes. `/` and `+` are both in the RFC 4648
 * alphabet, so roughly one base64 value in 64 begins with a slash; reading that
 * as an absolute path would clear a credential (M-5). A real path breaks the run
 * with a second separator, a dot, an underscore or a hyphen.
 */
function looksBase64(value: string): boolean {
  if (value.includes('+')) return true
  return isHighEntropyToken(value.replace(/^\//, '').replace(/=+$/, ''))
}

/**
 * A location, not a credential: a URL naming an endpoint, or a filesystem path.
 *
 * A URL is only a location while it carries nothing credential-shaped. It stops
 * being one when the authority has userinfo (`scheme://user@host`,
 * `scheme://user:pass@host`), when a path segment is a generated token (a webhook
 * URL whose path IS the secret), or when a query parameter is named like a
 * credential or holds one (an API key or a presigned signature). I-3.
 */
function isLocationValue(value: string): boolean {
  const v = value.trim()
  const url = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?/.exec(v)
  if (url) {
    const authority = url[1] ?? ''
    // Everything before `@` is a user name, a password or a token.
    if (authority.includes('@')) return false
    for (const segment of (url[2] ?? '').split('/')) if (isHighEntropyToken(segment)) return false
    // The query AND the fragment (A-21 / R-1): OAuth's implicit flow returns the
    // access token after the `#`, in exactly the `name=value&name=value` shape
    // the query uses, so a redirect URI pasted into a note carries a live token
    // in the half a query-only scan never looked at.
    //
    // The fragment is read only where it HAS that shape. A bare anchor carries
    // no `=`, and `#api-key-rotation` is a heading, not a credential — judging a
    // name with no value would flag every documentation link that mentions keys.
    for (const [encoded, needsValue] of [
      [url[3] ?? '', false],
      [url[4] ?? '', true],
    ] as const) {
      for (const pair of encoded.split(/[&;]/)) {
        if (!pair) continue
        const eq = pair.indexOf('=')
        if (needsValue && eq < 0) continue
        const name = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase()
        if (name.split(/[-_.]/).some((word) => CREDENTIAL_PARAM_WORDS.has(word))) return false
        if (eq >= 0 && isHighEntropyToken(pair.slice(eq + 1))) return false
      }
    }
    return true
  }
  // Only the anchored path forms: a bare slash-separated value is not treated as
  // a path, because `/` is in the base64 alphabet.
  return /^(~\/|\.{1,2}\/|\/)/.test(v) && !looksBase64(v)
}

/** The bare nouns this heuristic keys on; a value that is one of them names a key. */
const CREDENTIAL_WORDS = new Set(['apikey', 'apikeys', 'secret', 'secrets', 'password', 'passwords', 'passwd', 'token', 'tokens'])

/**
 * The value repeats its own key (`tokens_used_month: tokens_used_month`,
 * `refresh_token = refreshToken`) or is itself a credential noun
 * (`secret: apikey`). Either way it names a key instead of carrying one.
 * Separators and case are ignored, so the two spellings of one name compare equal.
 */
function namesItsOwnKey(key: string, value: string): boolean {
  const norm = (s: string): string => s.replace(/[-_]/g, '').toLowerCase()
  const v = norm(value)
  return v === norm(key) || CREDENTIAL_WORDS.has(v)
}

/**
 * A FLAG, never a refusal (R11.4): the scanner tags the row `contains-secrets`
 * and recall hides it by default. Hard indicators only — a credential-shaped
 * file name, a private-key block, a provider token, a literal `KEY=value`.
 * A lookup (`keychain_lookup(...)`, `os.environ[...]`) and a placeholder
 * (`<your-key>`, `xxx`) are not secrets.
 *
 * Exported so that every reading path shares ONE predicate instead of relying
 * on `classifyPath` being reached: the registry runs it after the adapter chain,
 * and the scanner runs it over the files bundled inside a skill package, which
 * are never classified at all. The whole text given is searched, not a window of
 * it — a key past the classification head is still a key.
 */
export function looksLikeSecrets(relativePath: string, content: string): boolean {
  const base = posix(relativePath).split('/').pop() ?? ''
  if (!SECRET_NAME_TEMPLATES.test(base)) {
    if (
      base === '.env' || base.startsWith('.env.') || base.endsWith('.env') ||
      base === 'credentials.json' || base === 'id_rsa' || base === 'id_ed25519' || base === 'id_ecdsa' ||
      base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12') || base.endsWith('.pfx')
    ) return true
  }
  if (PRIVATE_KEY_BLOCK.test(content)) return true
  for (const m of content.matchAll(PROVIDER_TOKEN)) {
    if (!isSecretPlaceholder(m[1]!.replace(/^(sk-|ghp_|github_pat_|xox[baprs]-)/, ''))) return true
  }
  for (const m of content.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const key = m[1]!
    const value = m[3]!
    if (isLookupExpression(value) || isSecretPlaceholder(value) || isLocationValue(value) || namesItsOwnKey(key, value)) continue
    return true
  }
  return false
}

const BINARY_HINT: HeuristicHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.9,
  reason: 'Binary file — no text to import',
  reasonCode: 'binary',
  selectedByDefault: false,
}
const DERIVED_HINT: HeuristicHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.9,
  reason: 'Derived index / generated state — not importable text',
  reasonCode: 'derived-index',
  selectedByDefault: false,
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|pdf|zip|p12|pfx|bin|exe|dll|so|dylib|o|class|wasm|xlsx?|pb)$/
const LOCKFILES = new Set(['package-lock.json', 'bun.lock', 'yarn.lock', 'pnpm-lock.yaml'])
export const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'lua', 'scala', 'dart', 'r', 'pl', 'm', 'mm', 'css', 'scss', 'less', 'vue', 'svelte', 'map', 'min.js', 'min.css'])
export const DATA_EXTS = new Set(['yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'plist', 'csv', 'tsv', 'xml', 'html', 'htm', 'svg', 'log', 'env', 'pem', 'key', 'crt', 'cer', 'properties', 'tex', 'bib'])
export const NOTE_EXTS = new Set(['md', 'markdown', 'mdown', 'txt', 'text', 'rst', 'adoc', 'org'])
const BOILERPLATE = new Set(['robots.txt', 'license', 'license.md', 'licence', 'licence.md', 'copying', 'changelog', 'changelog.md', 'contributing', 'contributing.md', 'code_of_conduct.md', 'security.md', 'authors', 'notice'])

export function isThirdPartyDocPath(p: string): boolean {
  const q = posix(p)
  return q.includes('.grok/docs/') || q.includes('/docs/user-guide/') || q.includes('/site-packages/') || q.includes('/vendor/')
}

/**
 * Markdown/text the owner did not author as memory: package caches, Photos
 * Spotlight, CLA trees, checkout docs, previous EYAS snapshots. Still listed
 * (R11 maps the tree); no longer ticked by default — the 2026-09-08 home
 * import pulled thousands of these into the vault.
 */
export function isDefaultOffNotePath(relativePath: string): boolean {
  const p = posix(relativePath)
  if (/(^|\/)eyas-memory-backup/.test(p)) return true
  if (isDurableMemoryPath(relativePath) || isSessionDumpPath(relativePath)) return false
  if (p.includes('.grok/memory/') || p.startsWith('.grok/memory/')) return false
  if (p.includes('.grok/sessions/') || p.startsWith('.grok/sessions/')) return false
  if (/(^|\/)\.claude\/(projects|skills|agents|commands|docs)\//.test(p)) return false
  if (p.startsWith('documents/') && !p.includes('.photoslibrary/') && !p.includes('/loxone/')) return false
  if (p.includes('.photoslibrary/')) return true
  if (/(^|\/)\.claude\/session-stats\//.test(p)) return true
  if (/\/doc\/cla\//.test(p)) return true
  if (/(^|\/)eyas-memory-backup/.test(p)) return true
  if (isThirdPartyDocPath(relativePath)) return true
  if (p.startsWith('github/') || p.startsWith('develop/') || p.startsWith('eyas/')) return true
  if (
    p.startsWith('.bun/') ||
    p.startsWith('.cargo/') ||
    p.startsWith('.pub-cache/') ||
    p.startsWith('.rustup/') ||
    p.startsWith('.npm/') ||
    p.startsWith('.vscode/') ||
    p.startsWith('.unsloth/') ||
    p.startsWith('.lmstudio/') ||
    p.startsWith('.codex/.tmp/') ||
    p.startsWith('.grok/marketplace-cache/') ||
    p.startsWith('.grok/bundled/')
  ) {
    return true
  }
  return false
}
export function isBoilerplateName(base: string): boolean {
  return BOILERPLATE.has(base) || base.startsWith('readme')
}
export function isLegacyMemoryPath(p: string): boolean {
  const q = posix(p)
  const base = q.split('/').pop() ?? q
  return /(^|\/)(memory\.local-backup[^/]*|memory\.old)\//.test(q) || base.endsWith('.bak')
}
/** Obsidian's own state (`.obsidian/**`): text, importable, unticked — the same treatment as assistant `settings.json` (R11.3, D-8). */
export function isObsidianConfigPath(p: string): boolean {
  return /(^|\/)\.obsidian\//.test(posix(p))
}
/** Agent rule folders (`.cursor/rules`, `.windsurf/rules`, `.claude/rules`, `.codeium/rules`) or any `.mdc`; a vault folder named `rules` is notes. */
export const RULE_FILE_RE = /(^|\/)\.(cursor|windsurf|claude|codeium)\/rules\/[^/]+\.(md|mdc)$|\.mdc$/

const extOf = (base: string): string => {
  if (base.endsWith('.min.js')) return 'min.js'
  if (base.endsWith('.min.css')) return 'min.css'
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1)
}

const withTags = (hint: HeuristicHint, tags: string[]): HeuristicHint =>
  tags.length ? { ...hint, tags: [...new Set([...(hint.tags ?? []), ...tags])] } : hint

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

/**
 * Selection rule, stated once: selected ⇔ kind ∈ {memory, session, index, skill,
 * rule, identity, persona}; `code` and `knowledge` are importable and unticked
 * (D-8); `noise` is bytes-only (binary, derived-index, app-state, empty). No text
 * row ever has `target: 'none'`. The secrets predicate only ever ADDS a tag.
 */
export function classifyPath(relativePath: string, content: string, profile?: SourceProfile): HeuristicHint {
  const hint = classifyText(relativePath, content, profile)
  return looksLikeSecrets(relativePath, content) ? withTags(hint, ['contains-secrets']) : hint
}

function classifyText(relativePath: string, content: string, profile?: SourceProfile): HeuristicHint {
  const p = posix(relativePath)
  const base = p.split('/').pop() ?? p
  const ext = extOf(base)
  const provenance = [...(isLegacyMemoryPath(p) ? ['legacy'] : []), ...(isThirdPartyDocPath(p) ? ['third-party'] : [])]

  if (isMemoryIndexFile(relativePath, content)) {
    return withTags(
      {
        kind: 'index',
        target: 'vault.semantic',
        confidence: 0.95,
        reason: 'One-line memory index — imported as one note; its hooks become note summaries',
        reasonCode: 'memory-index',
        selectedByDefault: true,
      },
      provenance,
    )
  }
  if (/\.(sqlite|sqlite-wal|sqlite-shm|db|ldb)$/.test(base) || LOCKFILES.has(base) || base.endsWith('.lock')) return DERIVED_HINT
  if (BINARY_EXT.test(base)) return BINARY_HINT
  // Reached only for uploads extracted by hand or a scan rooted inside such a
  // directory (the walker maps the class as one row otherwise): honest label, visible.
  if (/(^|\/)(node_modules|\.git|\.hg|\.svn)\//.test(p)) {
    return {
      kind: 'knowledge',
      target: 'vault.semantic',
      confidence: 0.3,
      reason: 'Inside a dependency / VCS directory',
      reasonCode: 'unrecognised',
      selectedByDefault: false,
    }
  }
  // Obsidian state: visible, importable, unticked (D-8) — never hidden as app-state (the walker reads it like any text).
  if (isObsidianConfigPath(relativePath)) {
    return {
      kind: 'knowledge',
      target: 'vault.semantic',
      confidence: 0.85,
      reason: 'Obsidian configuration / state — importable, not selected',
      reasonCode: 'config',
      selectedByDefault: false,
    }
  }

  // Rules — anywhere under the root (R11.3): every repo's CLAUDE.md / AGENTS.md / .cursor/rules/*.mdc is a proposal.
  if (base === 'claude.md' || base === 'agents.md' || base === 'gemini.md' || base === 'global_rules.md' || base === '.cursorrules' || RULE_FILE_RE.test(p)) {
    return withTags(
      {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.88,
        reason: 'Project/agent rules file',
        reasonCode: 'rules-file',
        selectedByDefault: true,
      },
      provenance,
    )
  }
  // Identity kinds stay gated on an assistant workspace path; outside it they are plain notes (fall through).
  if (isAssistantWorkspacePath(relativePath)) {
    if (base === 'soul.md' || base === 'soul.style.json') {
      return { kind: 'identity', target: 'workspace.soul', confidence: 0.9, reason: 'Agent soul / persona', reasonCode: 'identity', selectedByDefault: true }
    }
    if (base === 'identity.md') {
      return { kind: 'identity', target: 'workspace.identity', confidence: 0.9, reason: 'Agent identity', reasonCode: 'identity', selectedByDefault: true }
    }
    if (base === 'tools.md') {
      return { kind: 'rule', target: 'workspace.tools', confidence: 0.85, reason: 'Tools policy', reasonCode: 'tools-policy', selectedByDefault: true }
    }
  }
  if (base === 'skill.md' || p.endsWith('/skill.md') || isAssistantSkillPath(relativePath)) {
    return withTags(
      { kind: 'skill', target: 'skill', confidence: 0.92, reason: 'Skill / procedure document', reasonCode: 'skill', selectedByDefault: true },
      provenance,
    )
  }

  // Sessions — both classes selected (R11.3 bullet 2). `type: moc` is an index page, not a session.
  const grokSummary = /(^|\/)\.grok\/memory\/[^/]+\/sessions\//.test(p)
  const sessionByFm = /^---[\s\S]*?\btype:\s*(claude-session|grok-session|session)\b/i.test(content.slice(0, 600))
  if ((isSessionDumpPath(relativePath) && !/^---[\s\S]*?\btype:\s*moc\b/i.test(content.slice(0, 600))) || grokSummary || sessionByFm) {
    return withTags(
      {
        kind: 'session',
        target: 'episodic',
        confidence: 0.85,
        reason: grokSummary ? 'Assistant session summary (structured memory)' : 'Session summary note',
        reasonCode: 'session-summary',
        selectedByDefault: true,
      },
      provenance,
    )
  }
  if (/(^|\/)\.(claude|grok|agents)\/agents\/[^/]+\.md$/.test(p) || /(^|\/)\.github\/agents\/[^/]+\.agent\.md$/.test(p)) {
    return { kind: 'persona', target: 'agent', confidence: 0.9, reason: 'Agent persona (frontmatter + prompt body)', reasonCode: 'persona', selectedByDefault: true }
  }

  if (isDurableMemoryPath(relativePath)) {
    return withTags(
      { kind: 'memory', target: 'vault.semantic', confidence: 0.8, reason: 'Long-lived memory note', reasonCode: 'memory-note', selectedByDefault: true },
      provenance,
    )
  }
  if (
    !isDefaultOffNotePath(relativePath) &&
    (p.includes('/semantic/') || /^---[\s\S]*tier:\s*semantic/i.test(content.slice(0, 400)))
  ) {
    return withTags(
      { kind: 'memory', target: 'vault.semantic', confidence: 0.9, reason: 'Semantic vault note', reasonCode: 'memory-note', selectedByDefault: true },
      provenance,
    )
  }
  if (
    !isDefaultOffNotePath(relativePath) &&
    (p.includes('/procedural/') || /^---[\s\S]*tier:\s*procedural/i.test(content.slice(0, 400)))
  ) {
    return withTags(
      { kind: 'memory', target: 'vault.procedural', confidence: 0.9, reason: 'Procedural vault note', reasonCode: 'memory-note', selectedByDefault: true },
      provenance,
    )
  }

  // Notes — owner memory stays ticked; checkout docs, caches and boilerplate
  // stay listed and importable, but are off by default (owner, 2026-09-08).
  if (NOTE_EXTS.has(ext) || base.endsWith('.md.bak') || (ext === 'bak' && /\.(md|markdown|txt)\.bak$/.test(base)) || base === 'robots.txt') {
    const procedural = /\b(how to|howto|runbook|checklist|procedure|lépés|útmutató)\b/i.test(content.slice(0, 500))
    const boiler = isBoilerplateName(base)
    const off = boiler || isDefaultOffNotePath(relativePath)
    return withTags(
      {
        kind: off ? 'knowledge' : 'memory',
        target: procedural && !off ? 'vault.procedural' : 'vault.semantic',
        confidence: off ? 0.45 : boiler ? 0.6 : 0.8,
        reason: off
          ? 'Boilerplate, checkout docs or cache text — importable, not selected'
          : procedural
            ? 'How-to / runbook style content'
            : profile === 'obsidian'
              ? 'Obsidian note'
              : 'Markdown note',
        reasonCode: off ? 'not-durable' : 'memory-note',
        selectedByDefault: !off,
      },
      provenance,
    )
  }
  if (CODE_EXTS.has(ext) || base === 'makefile' || base === 'dockerfile') {
    return { kind: 'code', target: 'vault.semantic', confidence: 0.6, reason: 'Source code — importable, not selected', reasonCode: 'source-code', selectedByDefault: false }
  }
  if (DATA_EXTS.has(ext) || base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) {
    return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.5, reason: 'Data or configuration text — importable, not selected', reasonCode: 'data-file', selectedByDefault: false }
  }
  if (ext === 'json' || ext === 'jsonl') {
    if (isAssistantDotDirPath(relativePath)) {
      return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.85, reason: 'Assistant configuration / state JSON — importable, not selected', reasonCode: 'config', selectedByDefault: false }
    }
    return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.45, reason: 'Structured JSON — importable, not selected', reasonCode: 'unknown-json', selectedByDefault: false }
  }
  return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.2, reason: 'Text of an unrecognised format — importable, not selected', reasonCode: 'unrecognised', selectedByDefault: false }
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
  const stripped = splitFrontmatter(content).body.replace(/\s+/g, ' ').trim()
  if (stripped.length <= max) return stripped
  return `${stripped.slice(0, max - 1)}…`
}
