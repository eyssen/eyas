// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { Logger } from 'pino'
import type { ModelGateway } from '@modules/model/types.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine.js'
import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type {
  GeneratedSkill,
  GeneratedSkillMetadata,
  SkillCandidate,
  SkillFrontmatter,
} from './types.js'

/**
 * Skill generator — Phase 3J.
 *
 * Given a SkillCandidate, materialise a SKILL.md file plus a metadata.json
 * under <rootDir>/<slug>/. The SKILL.md format mirrors Anthropic's skill
 * format: YAML-like frontmatter followed by a markdown body with sections
 * for "When to invoke", "Tools", and "Steps".
 */

// Single-line guard — name/description/version/whenToInvoke are semantically
// one-liners; a newline is either a mistake or an attempt to inject an extra
// frontmatter key (see renderFrontmatter's escape()). Reject rather than
// silently collapse, so authorSkillMd's safeParse fails open to the
// deterministic renderSkillMd() on a multiline model field.
const singleLine = z.string().regex(/^[^\r\n]*$/, 'must not contain a newline')

// Frontmatter Zod schema — validated both when we generate and when we
// re-parse in tests. Keys are restricted to avoid injecting arbitrary fields.
export const SkillFrontmatterSchema = z.object({
  name: singleLine.pipe(z.string().min(1).max(200)),
  description: singleLine.pipe(z.string().min(1).max(1000)),
  whenToInvoke: z.array(singleLine.pipe(z.string().min(1))).min(1).max(32),
  tools: z.array(z.string().min(1)).max(64),
  license: z.literal('MIT'),
  version: singleLine.pipe(z.string().min(1).max(50)),
}) satisfies z.ZodType<SkillFrontmatter>

export interface GeneratorOptions {
  /** Absolute path to the directory where skill folders live. */
  rootDir: string
  /** Version string to embed in frontmatter + metadata. Default '0.1.0'. */
  version?: string
}

export interface SkillGeneratorDeps {
  /**
   * Cheap-tier ('heartbeat' tier) model gateway — authors name/description/
   * whenToInvoke + a genuine procedural body from the observed pattern
   * (see authorSkillMd below). `tools`, `license` and `version` stay
   * deterministic regardless, so a hallucinated tool name or license can't
   * slip through. Absent/erroring model, or output that fails
   * SkillFrontmatterSchema, fails open to renderSkillMd(); never throws.
   */
  model?: Pick<ModelGateway, 'complete'>
  decisionEngine?: DecisionEngine
  logger?: Logger
}

/**
 * Render frontmatter as a simple key: value / key:\n - item block.
 * We do NOT depend on a YAML library — the output is a restricted, hand-
 * written subset that's trivially parseable.
 */
export function renderFrontmatter(fm: SkillFrontmatter): string {
  // Strip/collapse C0 control chars + DEL (incl. \n, \r, \t) to a space FIRST
  // — otherwise a newline in a free-text model-authored value (name/
  // description/whenToInvoke) would split it across lines in the emitted
  // frontmatter, and the tail line could re-match parseFrontmatter's
  // line-oriented `^key:` regex and inject/override an arbitrary key (e.g.
  // `license: GPL`). Escape quotes LAST so control-stripping never touches
  // a `\` or `"` we just inserted.
  const escape = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/"/g, '\\"')
  const lines: string[] = ['---']
  lines.push(`name: "${escape(fm.name)}"`)
  lines.push(`description: "${escape(fm.description)}"`)
  lines.push(`license: ${fm.license}`)
  lines.push(`version: "${escape(fm.version)}"`)
  lines.push('whenToInvoke:')
  for (const t of fm.whenToInvoke) lines.push(`  - "${escape(t)}"`)
  if (fm.tools.length > 0) {
    lines.push('tools:')
    for (const t of fm.tools) lines.push(`  - "${escape(t)}"`)
  } else {
    lines.push('tools: []')
  }
  lines.push('---')
  return lines.join('\n')
}

/**
 * Parse a frontmatter block produced by renderFrontmatter. Only the exact
 * format we emit is supported — this is not a general YAML parser.
 */
export function parseFrontmatter(content: string): unknown {
  const match = content.match(/^---\n([\s\S]*?)\n---/m)
  if (!match) throw new Error('Missing frontmatter')
  const body = match[1]!
  const parsed: Record<string, unknown> = {}
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (!kv) {
      i++
      continue
    }
    const key = kv[1]!
    const value = kv[2]!
    if (value === '') {
      // Array follows
      const arr: string[] = []
      i++
      while (i < lines.length && /^\s+-\s*"/.test(lines[i] ?? '')) {
        const m = lines[i]!.match(/^\s+-\s*"(.*)"\s*$/)
        if (m) arr.push(m[1]!.replace(/\\"/g, '"'))
        i++
      }
      parsed[key] = arr
      continue
    }
    if (value === '[]') {
      parsed[key] = []
      i++
      continue
    }
    const quoted = value.match(/^"(.*)"$/)
    parsed[key] = quoted ? quoted[1]!.replace(/\\"/g, '"') : value
    i++
  }
  return parsed
}

export function renderBody(candidate: SkillCandidate): string {
  const tools = candidate.pattern.toolChain.map((b) => b.toolName)
  const lines: string[] = []
  lines.push(`# ${candidate.pattern.name}`)
  lines.push('')
  lines.push(candidate.pattern.description)
  lines.push('')
  lines.push('## When to invoke')
  if (candidate.pattern.triggers.length === 0) {
    lines.push('- (no triggers mined — human review required)')
  } else {
    for (const t of candidate.pattern.triggers) lines.push(`- ${t}`)
  }
  lines.push('')
  lines.push('## Tools')
  if (tools.length === 0) {
    lines.push('- (no tools — candidate is degenerate)')
  } else {
    for (const b of candidate.pattern.toolChain) {
      const schemaKeys = Object.keys(b.schema).join(', ') || '(none)'
      lines.push(`- **${b.toolName}** — inputs: ${schemaKeys}`)
    }
  }
  lines.push('')
  lines.push('## Observations')
  lines.push(`- Times observed: ${candidate.observations.timesObserved}`)
  lines.push(`- Average turns: ${candidate.observations.averageTurns}`)
  lines.push(`- Average cost (USD): ${candidate.observations.averageCost}`)
  lines.push(`- Observed success rate: ${candidate.observations.successRate}`)
  lines.push('')
  lines.push('## Provenance')
  lines.push(`- Candidate id: ${candidate.id}`)
  lines.push(`- Proposed by: ${candidate.proposedBy}`)
  lines.push(`- Sessions: ${candidate.fromSessionIds.join(', ')}`)
  lines.push('')
  return lines.join('\n')
}

export function buildFrontmatter(
  candidate: SkillCandidate,
  version: string,
): SkillFrontmatter {
  const fm: SkillFrontmatter = {
    name: candidate.pattern.name,
    description: candidate.pattern.description,
    whenToInvoke:
      candidate.pattern.triggers.length > 0
        ? candidate.pattern.triggers
        : ['(no triggers mined — human review required)'],
    tools: candidate.pattern.toolChain.map((b) => b.toolName),
    license: 'MIT',
    version,
  }
  // Validate before we hand back — guarantees downstream parsers will accept.
  SkillFrontmatterSchema.parse(fm)
  return fm
}

export function renderSkillMd(
  candidate: SkillCandidate,
  version: string,
): { frontmatter: SkillFrontmatter; content: string } {
  const frontmatter = buildFrontmatter(candidate, version)
  const content = `${renderFrontmatter(frontmatter)}\n\n${renderBody(candidate)}`
  return { frontmatter, content }
}

/**
 * Parse the model's raw JSON authoring response. Strips markdown code
 * fences the same way memory/consolidator/semantic-promoter.ts does. Returns
 * null on any shape mismatch — the caller fails open to the deterministic
 * renderer.
 */
function parseAuthoredSkill(
  raw: string,
): { name: string; description: string; whenToInvoke: string[]; body: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (
      typeof parsed?.name !== 'string' ||
      typeof parsed?.description !== 'string' ||
      typeof parsed?.body !== 'string' ||
      !Array.isArray(parsed.whenToInvoke)
    ) {
      return null
    }
    const whenToInvoke = parsed.whenToInvoke.filter(
      (t: unknown): t is string => typeof t === 'string' && t.length > 0,
    )
    if (whenToInvoke.length === 0 || !parsed.body.trim()) return null
    return { name: parsed.name, description: parsed.description, whenToInvoke, body: parsed.body }
  } catch {
    return null
  }
}

/**
 * Model-authoring pass — feeds the candidate's pattern, tool chain,
 * observation stats and mined trigger phrases to the cheap tier and asks for
 * a genuine name/description/whenToInvoke + procedural body. Returns null on
 * any failure (missing model, thrown error, empty output, bad JSON, or a
 * frontmatter that fails SkillFrontmatterSchema) so the caller fails open to
 * renderSkillMd(). Never throws.
 */
async function authorSkillMd(
  candidate: SkillCandidate,
  version: string,
  deps: SkillGeneratorDeps,
): Promise<{ frontmatter: SkillFrontmatter; content: string } | null> {
  if (!deps.model?.complete) return null

  const toolLines = candidate.pattern.toolChain
    .map((b) => `- ${b.toolName}: ${JSON.stringify(b.schema)}`)
    .join('\n')
  const triggerLines = candidate.pattern.triggers.map((t) => `- ${t}`).join('\n')

  const system =
    'You are authoring a reusable EYAS skill file (SKILL.md) from an observed successful ' +
    'tool-use pattern. Write a genuine, specific procedural skill for an agent to follow — ' +
    'not a restatement of the raw data. Respond with ONLY a JSON object, no markdown fences, ' +
    'no prose, with keys: name (short kebab-case slug), description (one sentence), ' +
    'whenToInvoke (array of trigger-phrase strings), body (a markdown document with ' +
    '"## When to invoke", "## Tools" and a numbered "## Steps" section).'
  const user = [
    `Pattern name: ${candidate.pattern.name}`,
    `Deterministic description: ${candidate.pattern.description}`,
    `Tool chain:\n${toolLines || '(none)'}`,
    `Mined trigger phrases / session goals:\n${triggerLines || '(none)'}`,
    `Observations: observed ${candidate.observations.timesObserved}x, ` +
      `avg ${candidate.observations.averageTurns} turns, ` +
      `${Math.round(candidate.observations.successRate * 100)}% success rate.`,
  ].join('\n')

  const raw = await runCheapModelPass(deps, { system, user, maxTokens: 800, temperature: 0.4, fallback: '' })
  if (!raw) return null

  const parsed = parseAuthoredSkill(raw)
  if (!parsed) {
    deps.logger?.warn('skill-generator: model authoring output failed to parse, falling back')
    return null
  }

  // tools/license/version stay deterministic — never model-authored, so a
  // hallucinated tool name or license can't slip through.
  const frontmatter: SkillFrontmatter = {
    name: parsed.name,
    description: parsed.description,
    whenToInvoke: parsed.whenToInvoke,
    tools: candidate.pattern.toolChain.map((b) => b.toolName),
    license: 'MIT',
    version,
  }
  const result = SkillFrontmatterSchema.safeParse(frontmatter)
  if (!result.success) {
    deps.logger?.warn(
      { issues: result.error.issues },
      'skill-generator: authored frontmatter failed schema validation, falling back',
    )
    return null
  }

  const content = `${renderFrontmatter(result.data)}\n\n${parsed.body.trim()}\n`
  return { frontmatter: result.data, content }
}

export function createSkillGenerator(opts: GeneratorOptions, deps: SkillGeneratorDeps = {}) {
  const version = opts.version ?? '0.1.0'
  const rootDir = resolve(opts.rootDir)

  return {
    async generate(candidate: SkillCandidate, now: number = Date.now()): Promise<GeneratedSkill> {
      const slug = candidate.pattern.name
      const directory = join(rootDir, slug)
      const skillMdPath = join(directory, 'SKILL.md')
      const metadataPath = join(directory, 'metadata.json')

      const authored = await authorSkillMd(candidate, version, deps)
      const { content } = authored ?? renderSkillMd(candidate, version)

      const metadata: GeneratedSkillMetadata = {
        version,
        candidateId: candidate.id,
        adoptionStatus: 'pending-experiment',
        createdAt: now,
        updatedAt: now,
      }

      await mkdir(directory, { recursive: true })
      await writeFile(skillMdPath, content, 'utf-8')
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

      return {
        slug,
        directory,
        skillMdPath,
        metadataPath,
        skillMdContent: content,
        metadata,
      }
    },
  }
}

export type SkillGenerator = ReturnType<typeof createSkillGenerator>
