// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

/** `getService` resolves `ctx.documents`, which only exists after documents.onStart. */
export function createDocumentTools(getService: () => any): ToolImplementation[] {
  const NOT_READY = { error: 'Documents module not ready yet — try again shortly' }

  return [
    {
      name: 'list_documents',
      description: 'List documents linked to a specific record (e.g. a conversation or a knowledge page).',
      category: 'documents',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          ownerModule: { type: 'string', description: 'The owning module (e.g. "conversation", "knowledge")' },
          ownerId: { type: 'string', description: 'The owning record ID' },
        },
        required: ['ownerModule', 'ownerId'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const documents = service.listByOwner(
          input.ownerModule as string,
          input.ownerId as string,
        )
        return { documents }
      },
    },
    {
      name: 'read_document',
      description: 'Get metadata for a document by its ID. Returns name, MIME type, size, and storage info.',
      category: 'documents',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The unique document identifier' },
        },
        required: ['documentId'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const document = service.getById(input.documentId as string)
        if (!document) return { error: `Document not found: ${input.documentId as string}` }
        return { document }
      },
    },
  ]
}
