// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'

/** `<module>.<widget>#<instance>` — the instance suffix lets one widget be placed twice (spec D3). */
const ITEM_KEY = /^[a-z0-9-]+\.[a-z0-9-]+#\d+$/

/** Grid breakpoint — shared by every endpoint that takes one, body or query string alike. */
export const breakpointSchema = z.enum(['lg', 'md', 'sm'])

// The server cannot validate `config` against a widget's own configSchema —
// that schema lives in the frontend widget definition, out of the server's
// reach. Backend validation is structural only: reject a config whose JSON
// serialisation exceeds this size, so a client can't use the layout row as
// unbounded storage.
const CONFIG_MAX_BYTES = 4096

const configSchema = z.record(z.string(), z.unknown()).optional().refine(
  (config) => config === undefined || new TextEncoder().encode(JSON.stringify(config)).length <= CONFIG_MAX_BYTES,
  { message: `config must serialise to at most ${CONFIG_MAX_BYTES} bytes` },
)

export const layoutItemSchema = z.object({
  i: z.string().regex(ITEM_KEY),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
  config: configSchema,
})

export const saveLayoutSchema = z.object({
  breakpoint: breakpointSchema,
  items: z.array(layoutItemSchema).max(40),
})
