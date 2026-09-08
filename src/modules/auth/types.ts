import { z } from 'zod'

// ─── Zod Schemas (input validation) ──────────────────

export const loginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
})

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128).optional(),
  displayName: z.string().min(1).max(128),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user', 'agent', 'guest']),
  isAgent: z.boolean().default(false),
})

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(['owner', 'admin', 'user', 'agent', 'guest']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
})

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
}).refine(
  (data) => !data.newPassword || data.currentPassword,
  { message: 'Current password required to set new password', path: ['currentPassword'] }
)

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  expiresInDays: z.number().int().positive().optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

// ─── TypeScript types ────────────────────────────────

export interface AuthUser {
  id: string
  username: string
  displayName: string
  email: string | null
  role: string
  isRootOwner: boolean
  isAgent: boolean
  status: string
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  id: string
  userId: string
  expiresAt: string
}

export interface AuthApiKey {
  id: string
  userId: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
  revokedAt: string | null
}
