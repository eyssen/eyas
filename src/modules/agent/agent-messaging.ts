// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'

export interface AgentMessageEntry {
  id: number
  sessionId: string
  fromAgent: string
  toAgent: string | null    // null = broadcast to all agents in session
  content: string
  createdAt: string
}

export function createAgentMessaging(db: any) {
  return {
    /**
     * Send a message from one agent to another (or broadcast).
     */
    send(sessionId: string, fromAgent: string, toAgent: string | null, content: string): AgentMessageEntry {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO agent_messages (session_id, from_agent, to_agent, content, created_at)
        VALUES (${sessionId}, ${fromAgent}, ${toAgent}, ${content}, ${now})`)
      const rows = db.all(sql`SELECT * FROM agent_messages WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT 1`) as any[]
      return toMessage(rows[0])
    },

    /**
     * Get messages for a specific agent in a session (direct + broadcast).
     */
    getForAgent(sessionId: string, agentId: string, sinceId?: number): AgentMessageEntry[] {
      if (sinceId) {
        const rows = db.all(sql`SELECT * FROM agent_messages
          WHERE session_id = ${sessionId} AND id > ${sinceId}
          AND (to_agent = ${agentId} OR to_agent IS NULL)
          ORDER BY id ASC`) as any[]
        return rows.map(toMessage)
      }
      const rows = db.all(sql`SELECT * FROM agent_messages
        WHERE session_id = ${sessionId}
        AND (to_agent = ${agentId} OR to_agent IS NULL)
        ORDER BY id ASC`) as any[]
      return rows.map(toMessage)
    },

    /**
     * Get all messages in a session (for monitoring/UI).
     */
    getAll(sessionId: string): AgentMessageEntry[] {
      const rows = db.all(sql`SELECT * FROM agent_messages WHERE session_id = ${sessionId} ORDER BY id ASC`) as any[]
      return rows.map(toMessage)
    },

    /**
     * Broadcast a discovery to all agents in a session.
     */
    broadcast(sessionId: string, fromAgent: string, content: string): AgentMessageEntry {
      return this.send(sessionId, fromAgent, null, content)
    },
  }
}

function toMessage(raw: any): AgentMessageEntry {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    fromAgent: raw.from_agent,
    toAgent: raw.to_agent ?? null,
    content: raw.content,
    createdAt: raw.created_at,
  }
}
