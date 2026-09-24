import { z } from 'zod'

export const ENUM_VALUES = {
  address: ['tegező', 'magázó', 'önöző', 'kontextus-érzékeny'] as const,
  tone: ['komoly', 'kiegyensúlyozott', 'baráti', 'laza', 'játékos'] as const,
  verbosity: ['lényegre törő', 'kiegyensúlyozott', 'részletező'] as const,
  directness: ['nagyon direkt', 'direkt + udvarias', 'diplomatikus', 'körülíró'] as const,
  humor: ['nincs', 'száraz/szellemes', 'könnyed', 'csípős/provokatív'] as const,
  emoji: ['soha', 'funkcionálisan', 'gyakran'] as const,
}

export const PRESET_KEYS = [
  'jarvis',
  'best-buddy',
  'senior-ceo',
  'pajtas-dev',
  'standup',
  'diplomata',
  'coach',
  'tutor',
] as const

const baseProfile = z.object({
  tone: z.enum(ENUM_VALUES.tone),
  verbosity: z.enum(ENUM_VALUES.verbosity),
  directness: z.enum(ENUM_VALUES.directness),
  humor: z.enum(ENUM_VALUES.humor),
  emoji: z.enum(ENUM_VALUES.emoji),
  blockedPhrases: z.array(z.string().max(80)).max(10).default([]),
  signature: z.string().max(200).default(''),
})

export const internalProfileSchema = baseProfile.extend({
  // Internal scope: address must NOT be 'kontextus-érzékeny' (the owner is known)
  address: z.enum(['tegező', 'magázó', 'önöző']),
})

export const externalProfileSchema = baseProfile.extend({
  // External scope: all 4 address values allowed including 'kontextus-érzékeny'
  address: z.enum(ENUM_VALUES.address),
})

export const soulStyleSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  preset: z.object({
    internal: z.enum([...PRESET_KEYS, 'custom'] as [string, ...string[]]),
    external: z.enum([...PRESET_KEYS, 'custom'] as [string, ...string[]]),
  }),
  internal: internalProfileSchema,
  external: externalProfileSchema,
})

export type SoulStyleParsed = z.infer<typeof soulStyleSchema>
export type InternalProfile = z.infer<typeof internalProfileSchema>
export type ExternalProfile = z.infer<typeof externalProfileSchema>
