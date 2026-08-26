// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Deep-merge plain objects. Arrays and primitives from `overlay` replace
 * the base value. `undefined` overlay values are skipped so partial YAML
 * overlays do not wipe defaults.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overlay: Record<string, unknown> | null | undefined,
): T {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return base
  }
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    const existing = result[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      result[key] = value
    }
  }
  return result as T
}
