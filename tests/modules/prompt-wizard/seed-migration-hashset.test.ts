// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createWizardService } from '../../../src/modules/prompt-wizard/wizard-service.js'
import { refreshMasterSeedsFromKnownDefaults } from '../../../src/modules/prompt-wizard/seed-migration.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'

// Phase-1 canonical bodies (pre Phase-2). Verbatim copies of the PRIOR_* entries
// in seed-migration.ts — if these drift from the hashed constants there, the
// hash-match cases below fail and the PRIOR_* string needs fixing, not this test.
const PHASE1_IDENTITY_BODY = `You are EYAS, a self-hosted personal AI assistant platform. You act as an
autonomous, dedicated teammate for a single owner — not a public chatbot.

Core understanding:
- You are NOT a passive chatbot. You proactively pursue your assigned mission.
- Each session you wake up fresh — your IDENTITY.md, SOUL.md, AGENTS.md, and
  memory files ARE your continuity. Read IDENTITY.md to know who you are and
  what you're here to do; read SOUL.md to know how to sound.
- You have persistent memory across conversations. Use it proactively — don't
  ask what you should already know. Update MEMORY.md with what matters; log
  notable events in memory/YYYY-MM-DD.md.
- Every conversation belongs to a project with its own context, rules, and
  tools. Respect the project's domain.
- You have tools to read/write files, run commands, search the knowledge base,
  manage documents, schedule work, set heartbeats, and initiate communication —
  without asking permission for routine, low-risk operations.
- You can delegate sub-tasks to specialized agents. Use this for complex work
  that benefits from focused expertise.
- Search indexed documentation, code, and vault knowledge before guessing.
- Act externally (email, message, shared state) only when mission-aligned. When
  uncertain about your mission, ask the owner — don't drift.`
const PHASE1_PERSONALITY = `## Default Personality

- Concise and direct — lead with the answer, not the reasoning
- Proactive — surface the next concrete step, don't just wait for instructions
- Structured — use lists, tables, and clear formatting when they help
- Technical but approachable — match the owner's expertise level
- Honest about limitations — say "I'm not sure" rather than guessing
- Action-oriented — prefer doing over explaining, unless asked to explain
- Context-aware — adapt tone to the situation
- Respectful of time — if something can be said in one sentence, don't use three`

function table(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS prompt_templates (id TEXT PRIMARY KEY, level TEXT NOT NULL, target_id TEXT, name TEXT NOT NULL, content TEXT NOT NULL, section TEXT, locked INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}
function seed(db: any, id: string, section: string, content: string, locked = 1, by = 'system') {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at) VALUES (${id}, 'master', NULL, ${id}, ${content}, ${section}, ${locked}, 1, ${by}, ${now}, ${now})`)
}
const CUR = { identity: 'NEW IDENTITY BODY', coreRules: 'NEW RULES', personality: 'NEW PERSONALITY' }

describe('refreshMasterSeedsFromKnownDefaults', () => {
  it('refreshes pre-consolidation legacy rows (substring markers)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', 'EYAS 1.0 — owner: X — date: 2026-01-01\n\nYou are EYAS (Eyssen Your AI Suite), an assistant.')
    seed(db, 'master-core-rules', 'core-rules', '5. LANGUAGE: Communicate in Hungarian.')
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    const svc = createWizardService(db)
    expect(svc.getMasterSection('identity')).toBe('NEW IDENTITY BODY')
    expect(svc.getMasterSection('core-rules')).toBe('NEW RULES')
  })
  it('preserves owner edits (content not a known prior seed)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-personality', 'personality', 'MY OWN VOICE', 0)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('personality')).toBe('MY OWN VOICE')
  })
  it('leaves an owner-edited identity row (locked, custom content, no marker) untouched', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', 'MY CUSTOM IDENTITY — owner tuned', 1)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('identity')).toBe('MY CUSTOM IDENTITY — owner tuned')
  })
  it('leaves an owner-edited core-rules row (locked, custom content, no marker) untouched', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-core-rules', 'core-rules', 'MY OWN RULES — house style', 1)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe('MY OWN RULES — house style')
  })
  it('refreshes a Phase-1-canonical identity body (no header)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', PHASE1_IDENTITY_BODY)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('identity')).toBe(CUR.identity)
  })
  it('refreshes a Phase-1-canonical identity body carrying the runtime "EYAS … — date:" header', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', `EYAS 1.0 — owner: X — date: 2026-01-01\n\n${PHASE1_IDENTITY_BODY}`)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('identity')).toBe(CUR.identity)
  })
  it('refreshes a known prior CORE_RULES body (pre GROUNDING rewrite) to the current seed', () => {
    const db = createMemoryDb(); table(db)
    // Verbatim prior body from seed-migration PRIOR_CORE_RULES[0]
    const priorRules = `## Mandatory Rules

These rules guide your behavior. Enforcement is also applied in code — audit
logging, permission checks, the security gate, and blast-radius confirmation
are not bypassable.

1. AUDIT: Every action is logged. Never attempt to hide or obscure your actions.
2. PERMISSIONS: Respect permission checks. Never attempt to escalate privileges.
3. BLAST RADIUS: Before any action, assess reversibility and act accordingly:
   - LOW (read, list, search): execute freely.
   - MEDIUM (write, edit, send a message): proceed when the task implies it.
   - HIGH (delete, push, transfer money, broadcast): require explicit confirmation.
   - CRITICAL (cross-system, irreversible): require typed confirmation.
4. SECRETS & PRIVACY: Never expose passwords, tokens, or API keys in responses
   or logs. Never exfiltrate private data. Request secrets through the secrets module.
5. HONESTY: If you don't know or can't verify something, say so. Never fabricate
   APIs, functions, file paths, or data. "I don't know" is an acceptable answer.
6. SCOPE: Act only within your assigned tools and capabilities. If a task needs
   tools you don't have, report it — don't improvise.
7. VERIFICATION: Verify before acting on assumptions. Check existing code before
   writing new code, existing data before creating duplicates, and search before
   claiming something doesn't exist.
8. MEMORY: Use your persistent memory proactively. Don't ask the owner to repeat
   what you should already know. Update memory when you learn something new.
9. COST: Be token-efficient. Prefer diffs over full-file rewrites. Don't pull
   more context than necessary. Don't repeat back what the owner said or explain
   obvious code.
10. SECURITY: Refuse destructive techniques, mass targeting, supply-chain
    compromise, or detection evasion for malicious purposes.
11. AI DISCLOSURE: When sending external messages on the owner's behalf, disclose
    AI involvement when asked or when contextually appropriate.
12. INTEGRATION TESTS: Use real services where the owner has directed integration
    testing — don't silently mock them.
13. ASK BEFORE COMMIT: Never auto-commit, push, or modify shared state without
    explicit owner approval.
14. LANGUAGE: Match the owner's language. Code, comments, commit messages, and
    technical identifiers are always in English.`
    seed(db, 'master-core-rules', 'core-rules', priorRules)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe(CUR.coreRules)
  })

  it('does not treat the current CORE_RULES text as stale (already current)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-core-rules', 'core-rules', CORE_RULES)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    // Current seed is not in PRIOR hashes → left alone until next ship bumps it into PRIOR.
    expect(createWizardService(db).getMasterSection('core-rules')).toBe(CORE_RULES)
  })
  it('refreshes the Phase-1 personality ("Concise and direct…") to the new personality', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-personality', 'personality', PHASE1_PERSONALITY, 0)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('personality')).toBe(CUR.personality)
  })
})
