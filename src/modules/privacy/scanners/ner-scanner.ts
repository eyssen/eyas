// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PiiScanner } from '../types.js'

const NER_PROMPT = `You are a PII detection system. Analyze the following text and identify any personally identifiable information (PII).

Return ONLY a JSON array of objects with these fields:
- type: one of "personal_id", "tax_number", "iban", "email", "phone", "credit_card", "ssn", "name", "address"
- value: the exact PII string found
- start: character offset in the original text
- end: character offset end

If no PII is found, return an empty array: []
Do not include any explanation, only the JSON array.

Text to analyze:
`

interface NerScannerOptions {
  baseUrl?: string
  model?: string
}

/**
 * Optional NER-based PII scanner using Ollama.
 * Lazy-loads: only checks Ollama availability on first scan call.
 * If Ollama is unavailable, returns empty results without errors.
 */
export function createNerScanner(options: NerScannerOptions = {}): PiiScanner {
  const baseUrl = options.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434'
  const model = options.model || 'llama3.2:1b'
  let available: boolean | null = null

  async function checkAvailability(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async function queryOllama(text: string): Promise<PiiMatch[]> {
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: NER_PROMPT + text }],
          stream: false,
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (!res.ok) return []

      const data = (await res.json()) as { message?: { content?: string } }
      const content = data.message?.content?.trim()
      if (!content) return []

      // Extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        type: string
        value: string
        start: number
        end: number
      }>

      return parsed.map((item) => ({
        type: item.type,
        value: item.value,
        start: item.start,
        end: item.end,
        confidence: 0.6, // NER confidence is moderate
        scanner: 'ner',
      }))
    } catch {
      return []
    }
  }

  return {
    id: 'ner',

    async scan(text: string): Promise<PiiMatch[]> {
      // Lazy availability check
      if (available === null) {
        available = await checkAvailability()
      }

      if (!available) return []

      return queryOllama(text)
    },
  }
}
