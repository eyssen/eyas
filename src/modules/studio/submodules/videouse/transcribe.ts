// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text'

export interface TranscribeDeps {
  fetchImpl?: typeof fetch
  apiKey: string
}

export async function transcribeSource(
  filePath: string,
  deps: TranscribeDeps,
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const buf = await readFile(filePath)
  const form = new FormData()
  form.set('model_id', 'scribe_v1')
  form.set('timestamps_granularity', 'word')
  form.set('diarize', 'true')
  form.set('file', new Blob([buf]), basename(filePath))

  const res = await fetchImpl(SCRIBE_URL, {
    method: 'POST',
    headers: { 'xi-api-key': deps.apiKey },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ElevenLabs Scribe failed (${res.status}): ${text.slice(0, 400)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('ElevenLabs Scribe returned non-JSON')
  }
}
