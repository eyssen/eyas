// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type { MediaGenerateRequest, MediaJob, MediaProvider } from './types.js'

export function createFakeMediaProvider(
  over?: Partial<MediaProvider> & { id?: string },
): MediaProvider {
  const id = over?.id ?? 'fake'
  const nowIso = () => new Date().toISOString()

  const base: MediaProvider = {
    id,
    name: over?.name ?? 'Fake Media',
    capabilities: over?.capabilities ?? ['image', 'video', 'audio', 'upscale', 'edit', '3d'],
    configured: over?.configured ?? true,
    async connect() {},
    async disconnect() {},
    async catalog(kind) {
      const models = [
        { id: `${id}-image`, label: 'Fake Image', kind: 'image' as const, providerId: id },
        { id: `${id}-video`, label: 'Fake Video', kind: 'video' as const, providerId: id },
      ]
      return kind ? models.filter((m) => m.kind === kind) : models
    },
    async generate(req: MediaGenerateRequest): Promise<MediaJob> {
      const ts = nowIso()
      return {
        id: generateId(),
        providerId: id,
        providerJobId: `vendor-${generateId()}`,
        kind: req.kind,
        status: 'completed',
        prompt: req.prompt,
        model: req.model ?? null,
        error: null,
        resultUrls: ['https://example.test/out.png'],
        documentIds: [],
        credits: null,
        conversationId: req.conversationId ?? null,
        batchId: null,
        agentId: req.agentId ?? null,
        userId: req.userId ?? null,
        createdAt: ts,
        updatedAt: ts,
        completedAt: ts,
      }
    },
    async status(_providerJobId: string) {
      return {
        status: 'completed' as const,
        resultUrls: ['https://example.test/out.png'],
        error: null,
        credits: null,
      }
    },
    async cancel(_jobId: string) {},
    async balance() {
      return { providerId: id, credits: 100, unit: 'credits' }
    },
  }

  return { ...base, ...over, id }
}
