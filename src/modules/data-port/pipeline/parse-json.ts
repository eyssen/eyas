// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Extract a JSON value from model output that may include fences or prose. */
export function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T
    } catch {
      return null
    }
  }

  const direct = tryParse(trimmed)
  if (direct !== null) return direct

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const fromFence = tryParse(fenced[1].trim())
    if (fromFence !== null) return fromFence
  }

  const arrayStart = trimmed.indexOf('[')
  const arrayEnd = trimmed.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const fromArr = tryParse(trimmed.slice(arrayStart, arrayEnd + 1))
    if (fromArr !== null) return fromArr
  }

  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    const fromObj = tryParse(trimmed.slice(objStart, objEnd + 1))
    if (fromObj !== null) return fromObj
  }

  return null
}
