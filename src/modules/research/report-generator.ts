// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { EvaluatedSource, ReportSection, ResearchAux } from './types.js'
import { createSourceFence, parseJsonArray } from './model-io.js'

const SectionsSchema = z.array(z.object({
  title: z.string().trim().min(1),
  content: z.string(),
})).min(1)

export interface SynthesisResult {
  sections: ReportSection[]
  /** False when the sections are the deterministic source list, not a model synthesis. */
  synthesized: boolean
}

/**
 * The report body without a model: one section per top source, its title and
 * its snippet plus URL. Data only — no UI strings.
 */
export function sourceSections(sources: EvaluatedSource[]): ReportSection[] {
  return sources.map((s) => ({
    title: s.title.trim() || s.url,
    content: [s.snippet.trim(), s.url].filter(Boolean).join('\n\n'),
  }))
}

/**
 * Synthesize report sections from the evaluated sources with the background
 * model. Source titles, snippets and page extracts travel inside a per-call
 * fence. Without a usable model answer the body is the source list.
 */
export async function synthesizeSections(
  aux: ResearchAux,
  query: string,
  sources: EvaluatedSource[],
): Promise<SynthesisResult> {
  const fallback = (): SynthesisResult => ({ sections: sourceSections(sources), synthesized: false })

  const fence = createSourceFence()
  const sourceContext = sources
    .map((s, i) => {
      const content = s.extractedContent
        ? `\n  Content: ${s.extractedContent.slice(0, 2000)}`
        : ''
      return `[${i + 1}] ${s.title} (${s.url})\n  Snippet: ${s.snippet}${content}`
    })
    .join('\n\n')

  const result = await aux.complete({
    purpose: 'research',
    system: `You are a research analyst. You synthesize web sources into a structured report.

${fence.rule}

Respond with a JSON array of sections, each with "title" (string) and "content" (string, markdown).
Include 3-5 sections. Use source citations like [1], [2] in the content.
Respond ONLY with the JSON array.`,
    user: `Write the report about: ${query}

Sources:
${fence.wrap(sourceContext)}

Respond ONLY with the JSON array of {"title","content"} sections.`,
    maxTokens: 4096,
    temperature: 0.3,
  })
  if (!result.ok) return fallback()

  const sections = parseJsonArray(result.text, SectionsSchema)
  return sections ? { sections, synthesized: true } : fallback()
}

/**
 * Cross-reference a synthesized report for contradictions with the background
 * model. The sections were written from web content, so they travel fenced
 * too. Without a usable model answer the sections are returned unchanged.
 */
export async function crossReference(
  aux: ResearchAux,
  query: string,
  sections: ReportSection[],
  sources: EvaluatedSource[],
): Promise<ReportSection[]> {
  const fence = createSourceFence()
  const sectionText = sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')

  const result = await aux.complete({
    purpose: 'research',
    system: `You review a research report for contradictions, inaccuracies, or unsupported claims.

${fence.rule}

If there are contradictions or issues, return a JSON array with the corrected sections (same format: "title", "content").
If the report is consistent, return the original sections unchanged.
Respond ONLY with the JSON array.`,
    user: `Research query: ${query}
Number of sources: ${sources.length}

Report:
${fence.wrap(sectionText)}

Respond ONLY with the JSON array of {"title","content"} sections.`,
    maxTokens: 4096,
    temperature: 0,
  })
  if (!result.ok) return sections
  return parseJsonArray(result.text, SectionsSchema) ?? sections
}

/** Build final Markdown report from sections and sources */
export function buildMarkdownReport(
  query: string,
  sections: ReportSection[],
  sources: EvaluatedSource[],
): string {
  const lines: string[] = [
    `# Research Report: ${query}`,
    '',
  ]

  for (const section of sections) {
    lines.push(`## ${section.title}`, '', section.content, '')
  }

  lines.push('## Sources', '')
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    lines.push(`${i + 1}. [${s.title}](${s.url}) — relevance: ${(s.relevance * 100).toFixed(0)}%`)
  }

  return lines.join('\n')
}
