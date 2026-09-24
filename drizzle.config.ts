import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: [
    './src/core/db/schema.ts',
    './src/modules/agent/schema.ts',
    './src/modules/conversations/schema.ts',
    './src/modules/communication/channels-schema.ts',
    './src/modules/communication/internal-contacts-schema.ts',
  ],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/sqlite/eyas.db',
  },
})
