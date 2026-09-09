// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { tryParseAgentConfig } from '../agent-config-preview'

describe('tryParseAgentConfig', () => {
  it('should parse a valid agent-config block', () => {
    const content = `Here is the agent I created:

\`\`\`agent-config
{"name":"Research Bot","role":"Researcher","description":"Finds info","tier":"specialist","tools":["web-search"]}
\`\`\`

Let me know if you want changes.`

    const result = tryParseAgentConfig(content)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Research Bot')
    expect(result!.role).toBe('Researcher')
    expect(result!.description).toBe('Finds info')
    expect(result!.tier).toBe('specialist')
    expect(result!.tools).toEqual(['web-search'])
  })

  it('should return null for regular content without code blocks', () => {
    const content = 'This is just plain text with no code blocks at all.'
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null for malformed JSON inside agent-config block', () => {
    const content = `\`\`\`agent-config
{name: not valid json, missing quotes}
\`\`\``
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null when required fields (name/role) are missing', () => {
    const content = `\`\`\`agent-config
{"description":"An agent without name or role"}
\`\`\``
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null for regular code blocks (not agent-config)', () => {
    const content = `\`\`\`json
{"name":"Some Agent","role":"Helper"}
\`\`\``
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should extract config when surrounded by other text', () => {
    const content = `# Agent Proposal

I suggest the following configuration:

\`\`\`agent-config
{"name":"DevOps Agent","role":"Infrastructure manager","goal":"Automate deployments"}
\`\`\`

This agent will handle CI/CD pipelines and monitoring.
Feel free to modify the configuration above.`

    const result = tryParseAgentConfig(content)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('DevOps Agent')
    expect(result!.role).toBe('Infrastructure manager')
    expect(result!.goal).toBe('Automate deployments')
  })
})
