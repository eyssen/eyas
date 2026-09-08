// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The synthetic source trees the opt-in scale test walks (Task 17, R11.7).
//
// Writes a synthetic source tree with a streaming loop — never an array of
// paths — so the generator itself cannot be what runs out of memory. Every name
// is alpha/bravo/charlie plus one astral folder; no tenant vault folder name
// appears anywhere.
//
// Four shapes:
//   small  ~105 importable rows, 0.5 MB — a smoke check that runs in a second
//   plan   9 000 rows, ≈190 MB — the plan's own numbers
//   scale  26 250 rows across 520 folders, ≈150 MB — crosses the 500-folder cap
//   tenx   260 000 rows + a 500 000-entry class directory, ≈1.5 GB — R11.1's bar

import { mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type Profile = 'small' | 'plan' | 'scale' | 'tenx'

export interface Shape {
  notes: number
  noteFolders: number
  sessions: number
  transcripts: number
  transcriptTurns: number
  skills: number
  conversations: number
  nmDirs: number
  nmFiles: number
  bodyKiB: number
}

export const SHAPES: Record<Profile, Shape> = {
  // Small enough to run in a second; proves every branch of the generator.
  small: { notes: 60, noteFolders: 6, sessions: 20, transcripts: 3, transcriptTurns: 4, skills: 2, conversations: 20, nmDirs: 2, nmFiles: 5, bodyKiB: 1 },
  // The plan's own numbers, so the brief's exact row assertion can be checked:
  // 3 000 + 900 + 80 + 20 + 5 000 = 9 000 importable rows, ≈190 MB.
  plan: { notes: 3_000, noteFolders: 300, sessions: 900, transcripts: 80, transcriptTurns: 200, skills: 20, conversations: 5_000, nmDirs: 40, nmFiles: 50, bodyKiB: 20 },
  // ≥26 000 rows, the figure the wizard's 381 ms-per-pass measurement was taken
  // at, across 520 folders so the 500-folder cap is crossed deliberately:
  // 12 000 + 3 000 + 200 + 50 + 11 000 = 26 250 importable rows, ≈150 MB.
  scale: { notes: 12_000, noteFolders: 520, sessions: 3_000, transcripts: 200, transcriptTurns: 200, skills: 50, conversations: 11_000, nmDirs: 40, nmFiles: 50, bodyKiB: 4 },
  // R11.1's explicit bar: ten times the owner's tree.
  tenx: { notes: 260_000, noteFolders: 20_000, sessions: 0, transcripts: 0, transcriptTurns: 0, skills: 0, conversations: 0, nmDirs: 2_000, nmFiles: 250, bodyKiB: 0 },
}

/** A folder name outside the BMP: the A-48 offset bug was invisible without one. */
const ASTRAL_DIR = 'charlie\u{2000B}notes'

/**
 * Directories are remembered, not re-created: the ten-times tree writes 760 000
 * files, and one `mkdirSync` per file is 740 000 syscalls that do nothing.
 */
let madeDirs = new Set<string>()
function put(root: string, rel: string, body: string | Buffer): void {
  const full = join(root, rel)
  const dir = join(full, '..')
  if (!madeDirs.has(dir)) {
    mkdirSync(dir, { recursive: true })
    madeDirs.add(dir)
  }
  writeFileSync(full, body)
}

export function buildScaleTree(root: string, profile: Profile): Shape {
  const s = SHAPES[profile]
  madeDirs = new Set<string>()
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  const body = s.bodyKiB > 0 ? 'alpha bravo charlie delta echo foxtrot golf.\n'.repeat(Math.ceil((s.bodyKiB * 1024) / 45)) : ''

  // ── 1. Plain notes across many folders, one of them astral-named ──────
  for (let i = 0; i < s.notes; i++) {
    const folder = i % s.noteFolders === 0 ? ASTRAL_DIR : `tree/f${i % s.noteFolders}`
    put(root, `${folder}/n${i}.md`, `---\ntype: reference\n---\n# alpha note ${i}\n\n${body}`)
  }

  // ── 2. Session summaries, detected by the folder name and `type:` ─────
  for (let i = 0; i < s.sessions; i++) {
    const day = String((i % 28) + 1).padStart(2, '0')
    put(
      root,
      `Documents/Vault/meta/claude-sessions/2026-08/2026-08-${day}_1200_alpha-${i}.md`,
      `---\ntype: claude-session\ndate: 2026-08-${day}\ntime: '12:00'\n---\n# alpha session ${i}\n\n${body}`,
    )
  }

  // ── 3. Containers: role-per-line transcripts ──────────────────────────
  for (let i = 0; i < s.transcripts; i++) {
    const lines: string[] = []
    for (let t = 0; t < s.transcriptTurns; t++) {
      lines.push(JSON.stringify({
        type: t % 2 ? 'assistant' : 'user',
        timestamp: `2026-08-01T12:${String(t % 60).padStart(2, '0')}:00Z`,
        message: { role: t % 2 ? 'assistant' : 'user', content: `turn ${t} of alpha ${i}. ${body}` },
      }))
    }
    const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    put(root, `.claude/projects/-alpha/${uuid}.jsonl`, lines.join('\n') + '\n')
  }

  // ── 4. Skill packages with assets, one carrying a credential ──────────
  for (let i = 0; i < s.skills; i++) {
    put(root, `.claude/skills/alpha-${i}/SKILL.md`, `---\nname: alpha-${i}\ndescription: alpha skill ${i}\n---\n# alpha skill ${i}\n\n${body}`)
    put(root, `.claude/skills/alpha-${i}/scripts/fetch.py`, 'password = keychain_lookup("alpha-db")\n')
    put(root, `.claude/skills/alpha-${i}/reference.md`, `# reference ${i}\n\n${body}`)
  }
  if (s.skills > 0) {
    // The credential-bearing asset: bundled, tagged, never refused (R11.4).
    put(root, '.claude/skills/alpha-0/.env', 'OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n')
  }

  // ── 5. A chat-export container ────────────────────────────────────────
  if (s.conversations > 0) {
    // Appended in chunks rather than joined at the end: a 60 MiB export built as
    // one array of 5 000 strings and then joined holds the whole thing twice,
    // and the point of this fixture is to test the SCANNER's memory, not the
    // generator's.
    const exportPath = 'Downloads/alpha-export/conversations.json'
    put(root, exportPath, '[')
    const full = join(root, exportPath)
    let chunk = ''
    for (let i = 0; i < s.conversations; i++) {
      chunk +=
        (i ? ',' : '') +
        JSON.stringify({
          title: `alpha conversation ${i}`,
          create_time: 1_760_000_000 + i,
          mapping: {
            a: { message: { author: { role: 'user' }, content: { parts: [`question ${i}. ${body}`] }, create_time: 1_760_000_000 + i } },
            b: { message: { author: { role: 'assistant' }, content: { parts: [`answer ${i}. ${body}`] }, create_time: 1_760_000_001 + i } },
          },
        })
      if (chunk.length > 4_000_000) {
        appendFileSync(full, chunk)
        chunk = ''
      }
    }
    appendFileSync(full, chunk + ']')
  }

  // ── 6. A credential-bearing note, a persona, a rule file, a flat root ─
  put(root, 'ai-memory/project_alpha_env.md', '---\ntype: project\n---\nDB_PASSWORD=alphaalphaalpha0001\n')
  put(root, '.claude/agents/alpha-persona.md', '---\nname: alpha-persona\ndescription: alpha persona\nmodel: sonnet\n---\nYou are the alpha reviewer.\n')
  put(root, 'GitHub/alpha/.cursor/rules/alpha.mdc', '---\nglobs: src/**/*.ts\n---\nAlways alpha.\n')
  put(root, 'GitHub/alpha/AGENTS.md', '# Alpha workspace rules\n\nAlways bravo.\n')
  put(root, 'CLAUDE.md', '# Root instructions\n\nAlways charlie.\n')
  put(root, 'Desktop/TODO.md', '# alpha todo\n\n- charlie\n')

  // ── 7. Directory classes: one dashed row each, never walked ───────────
  for (let d = 0; d < s.nmDirs; d++) {
    for (let f = 0; f < s.nmFiles; f++) {
      put(root, `GitHub/alpha/node_modules/pkg${d}/f${f}.js`, '')
    }
  }
  put(root, 'GitHub/alpha/.cache/x.txt', 'cached')

  // ── 8. A binary, so the noise class is exercised ──────────────────────
  put(root, 'notes/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  return s
}
