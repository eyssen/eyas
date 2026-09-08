// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Written into data/opencode/plugins/eyas-memory.ts. Runs inside OpenCode. */
export const EYAS_MEMORY_PLUGIN_SOURCE = `import { tool } from "@opencode-ai/plugin"

async function callEyas(path, body) {
  const base = process.env.EYAS_OPENCODE_EYAS_URL
  const token = process.env.EYAS_OPENCODE_PLUGIN_TOKEN
  if (!base || !token) return "EYAS memory bridge is not configured"
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return await res.text()
}

export const EyasMemoryPlugin = async () => {
  return {
    tool: {
      eyas_query_memory: tool({
        description:
          "Search EYAS memory (gists, facts, vault notes). Read-only quoted hits. Use before inventing project facts.",
        args: {
          query: tool.schema.string().describe("Natural language search query"),
          limit: tool.schema.number().optional().describe("Max hits, default 8"),
        },
        async execute(args) {
          return await callEyas("/api/v1/opencode/memory/query", {
            query: args.query,
            limit: args.limit ?? 8,
          })
        },
      }),
      eyas_save_memory: tool({
        description:
          "Persist a note, diff summary, or reasoning step into EYAS L0 memory. Not a substitute for files.",
        args: {
          content: tool.schema.string().describe("Plain text to store"),
          kind: tool.schema.string().optional().describe("note | diff | reasoning | stdout"),
        },
        async execute(args) {
          return await callEyas("/api/v1/opencode/memory/save", {
            content: args.content,
            kind: args.kind ?? "note",
          })
        },
      }),
    },
  }
}
`
