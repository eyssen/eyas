import type { BenchmarkTask, Rng } from './types.js'

/**
 * Mulberry32 deterministic RNG. Small, fast, adequate for seeded selection.
 * MIT-compatible algorithm (public domain / CC0).
 */
export function createRng(seed?: number): Rng {
  let state = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick: empty array')
      const idx = Math.floor(next() * items.length)
      return items[Math.min(idx, items.length - 1)]!
    },
  }
}

/**
 * Pick a prompt variation for a given task. The original prompt is always part
 * of the candidate pool, so every run has a non-zero chance of hitting it.
 *
 * Anti-gaming motivation: if a model is tuned to exact-match a benchmark prompt,
 * randomizing the wording per run reduces the upside of such overfitting.
 */
export function pickPrompt(task: BenchmarkTask, rng: Rng): string {
  const candidates = [task.prompt, ...(task.promptVariations ?? [])]
  return rng.pick(candidates)
}
