// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelGateway } from '@modules/model/types.js'
import type { EvaluatedSource, ReportSection } from './types.js'

/** AI-based synthesis: generates report sections from evaluated sources */
export async function synthesizeSections(
  model: ModelGateway,
  query: string,
  sources: EvaluatedSource[],
): Promise<ReportSection[]> {
  const sourceContext = sources
    .map((s, i) => {
      const content = s.extractedContent
        ? `\n  Content: ${s.extractedContent.slice(0, 2000)}`
        : ''
      return `[${i + 1}] ${s.title} (${s.url})\n  Snippet: ${s.snippet}${content}`
    })
    .join('\n\n')

  const response = await model.complete({
    messages: [
      {
        role: 'user',
        content: `You are a research analyst. Synthesize the following sources into a structured report about: "${query}"

Sources:
${sourceContext}

Respond with a JSON array of sections, each with "title" (string) and "content" (string, markdown).
Include 3-5 sections. Use source citations like [1], [2] in the content.
Respond ONLY with the JSON array.`,
      },
    ],
    maxTokens: 4096,
    temperature: 0.3,
  })

  const text = typeof response.content[0] === 'object' && response.content[0].type === 'text'
    ? response.content[0].text
    : ''

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in response')
    return JSON.parse(jsonMatch[0]) as ReportSection[]
  } catch {
    return [{ title: 'Summary', content: text || 'Unable to synthesize report.' }]
  }
}

/** AI-based cross-reference check for contradictions */
export async function crossReference(
  model: ModelGateway,
  query: string,
  sections: ReportSection[],
  sources: EvaluatedSource[],
): Promise<ReportSection[]> {
  const sectionText = sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')

  const response = await model.complete({
    messages: [
      {
        role: 'user',
        content: `Review this research report for contradictions, inaccuracies, or unsupported claims.

Query: "${query}"

Report:
${sectionText}

Number of sources: ${sources.length}

If there are contradictions or issues, return a JSON array with the corrected sections (same format: "title", "content").
If the report is consistent, return the original sections unchanged.
Respond ONLY with the JSON array.`,
      },
    ],
    maxTokens: 4096,
    temperature: 0,
  })

  const text = typeof response.content[0] === 'object' && response.content[0].type === 'text'
    ? response.content[0].text
    : ''

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in response')
    return JSON.parse(jsonMatch[0]) as ReportSection[]
  } catch {
    return sections
  }
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
