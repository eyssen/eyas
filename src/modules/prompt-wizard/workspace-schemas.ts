import { z } from 'zod'

export const workspaceFrontmatterSchema = z.object({
  schema: z.literal('eyas.workspace.v1'),
  agentId: z.string().min(1),
  generatedAt: z.string().datetime(),
}).passthrough()

const REQUIRED_IDENTITY_SECTIONS = ['## Who I am', '## My mission', '## Ongoing proactive duties']

export const identityMdSchema = z.string().refine(
  (content) => REQUIRED_IDENTITY_SECTIONS.every((heading) => content.includes(heading)),
  { message: 'IDENTITY.md missing required sections (Who I am, My mission, Ongoing proactive duties)' },
)

export const agentsMdSchema = z.string()
export const toolsMdSchema = z.string()
export const memoryMdSchema = z.string()
export const dailyMemoryMdSchema = z.string()

export const soulMdSchema = z.string().refine(
  (content) => content.includes('## [Internal Voice]') && content.includes('## [External Voice]'),
  { message: 'SOUL.md must contain both [Internal Voice] and [External Voice] sections' },
)
