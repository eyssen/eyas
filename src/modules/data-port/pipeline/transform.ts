// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import {
  buildMemoryTransformSystemPrompt,
  buildMemoryTransformUserPrompt,
} from '../prompts/transform-memory.js'
import {
  buildSkillTransformSystemPrompt,
  buildSkillTransformUserPrompt,
} from '../prompts/transform-skill.js'
import type {
  CandidateTarget,
  MemoryTransformResult,
  ScanCandidate,
  SkillTransformResult,
  SourceProfile,
} from '../types.js'
import { extractJson } from './parse-json.js'

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/m, '').trim()
}

function memoryFallback(candidate: ScanCandidate, target: CandidateTarget): MemoryTransformResult {
  const body = stripFrontmatter(candidate.content ?? candidate.preview)
  return {
    title: candidate.title,
    body: body.slice(0, 4000),
    tags: ['imported'],
    links: [],
    salience: target === 'episodic' ? 0.6 : 0.7,
    summary_one_line: candidate.preview.slice(0, 160),
  }
}

function skillFallback(candidate: ScanCandidate): SkillTransformResult {
  const body = stripFrontmatter(candidate.content ?? candidate.preview)
  const name = candidate.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'imported-skill'
  return {
    name: candidate.title.slice(0, 80) || name,
    description: candidate.preview.slice(0, 200),
    trigger_patterns: [candidate.title].filter(Boolean).slice(0, 3),
    capabilities: [],
    content: body.slice(0, 6000) || `# ${candidate.title}\n\n(Imported skill)`,
    skill_type: 'knowledge',
  }
}

export async function transformMemory(
  ctx: CheapModelPassContext,
  candidate: ScanCandidate,
  target: CandidateTarget,
  sourceProfile: SourceProfile,
): Promise<MemoryTransformResult> {
  const fallback = memoryFallback(candidate, target)
  const raw = await runCheapModelPass(ctx, {
    system: buildMemoryTransformSystemPrompt(),
    user: buildMemoryTransformUserPrompt({
      target,
      sourceProfile,
      path: candidate.relativePath,
      title: candidate.title,
      content: candidate.content ?? candidate.preview,
    }),
    maxTokens: 1200,
    temperature: 0.3,
    fallback: JSON.stringify(fallback),
  })
  const parsed = extractJson<Partial<MemoryTransformResult>>(raw)
  if (!parsed || typeof parsed.body !== 'string' || !parsed.body.trim()) return fallback
  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.title,
    body: parsed.body.trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 20) : fallback.tags,
    links: Array.isArray(parsed.links) ? parsed.links.map(String).slice(0, 20) : [],
    salience: typeof parsed.salience === 'number' ? Math.min(1, Math.max(0, parsed.salience)) : fallback.salience,
    summary_one_line:
      typeof parsed.summary_one_line === 'string'
        ? parsed.summary_one_line
        : fallback.summary_one_line,
  }
}

export async function transformSkill(
  ctx: CheapModelPassContext,
  candidate: ScanCandidate,
): Promise<SkillTransformResult> {
  const fallback = skillFallback(candidate)
  const raw = await runCheapModelPass(ctx, {
    system: buildSkillTransformSystemPrompt(),
    user: buildSkillTransformUserPrompt({
      path: candidate.relativePath,
      title: candidate.title,
      content: candidate.content ?? candidate.preview,
    }),
    maxTokens: 1400,
    temperature: 0.3,
    fallback: JSON.stringify(fallback),
  })
  const parsed = extractJson<Partial<SkillTransformResult>>(raw)
  if (!parsed || typeof parsed.content !== 'string' || !parsed.content.trim()) return fallback
  return {
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallback.name,
    description: typeof parsed.description === 'string' ? parsed.description : fallback.description,
    trigger_patterns: Array.isArray(parsed.trigger_patterns)
      ? parsed.trigger_patterns.map(String).slice(0, 12)
      : fallback.trigger_patterns,
    capabilities: Array.isArray(parsed.capabilities)
      ? parsed.capabilities.map(String).slice(0, 12)
      : [],
    content: parsed.content.trim(),
    skill_type: parsed.skill_type === 'tool' || parsed.skill_type === 'integration'
      ? parsed.skill_type
      : 'knowledge',
  }
}
