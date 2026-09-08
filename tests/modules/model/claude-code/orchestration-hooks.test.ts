// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildOrchestrationHooks } from '@modules/model/submodules/claude-code/orchestration-hooks.js'
import { createRunSeq, type OrchestrationEvent } from '@shared/orchestration-events.js'

function setup(parentNodeId: string | null = 'conv:c1') {
  const events: OrchestrationEvent[] = []
  const { hooks } = buildOrchestrationHooks({ runId: 'run1', parentNodeId, emit: (e) => events.push(e), seq: createRunSeq() })
  const fire = async (event: string, input: Record<string, unknown>) => {
    const matchers = (hooks as any)[event] ?? []
    for (const m of matchers) for (const h of m.hooks) await h(input, undefined, { signal: new AbortController().signal })
  }
  return { events, fire, hooks }
}

describe('buildOrchestrationHooks', () => {
  it('SubagentStart → node_started nested under the parent node', async () => {
    const { events, fire } = setup('conv:c1')
    await fire('SubagentStart', { agent_id: 'a1', agent_type: 'code-reviewer' })
    expect(events[0]).toMatchObject({
      runId: 'run1',
      nodeId: 'sub:a1',
      parentId: 'conv:c1',
      payload: { type: 'node_started', kind: 'subagent', label: 'code-reviewer' },
    })
  })

  it('SubagentStop → node_completed with the last assistant message as summary', async () => {
    const { events, fire } = setup('conv:c1')
    await fire('SubagentStart', { agent_id: 'a1', agent_type: 'dev' })
    await fire('SubagentStop', { agent_id: 'a1', agent_type: 'dev', last_assistant_message: 'done it' })
    expect(events[1]).toMatchObject({
      nodeId: 'sub:a1',
      parentId: 'conv:c1',
      payload: { type: 'node_completed', status: 'completed', summary: 'done it' },
    })
  })

  it('PreToolUse attributes by agent_id — correct even with parallel subagents', async () => {
    const { events, fire } = setup()
    await fire('SubagentStart', { agent_id: 'a1', agent_type: 'dev' })
    await fire('SubagentStart', { agent_id: 'a2', agent_type: 'qa' })
    await fire('PreToolUse', { agent_id: 'a2', tool_name: 'Read', tool_input: {}, tool_use_id: 't1' })
    const tool = events.find((e) => e.payload.type === 'tool_started')
    expect(tool).toMatchObject({ nodeId: 'sub:a2', payload: { type: 'tool_started', toolId: 't1', name: 'Read' } })
  })

  it('PreToolUse from the main thread lands on the parent node', async () => {
    const { events, fire } = setup('conv:c1')
    await fire('PreToolUse', { tool_name: 'Bash', tool_input: {}, tool_use_id: 't2' })
    expect(events[0]).toMatchObject({ nodeId: 'conv:c1', payload: { type: 'tool_started', toolId: 't2', name: 'Bash' } })
  })

  it('PreToolUse from the main thread with no parent node emits nothing', async () => {
    const { events, fire } = setup(null)
    await fire('PreToolUse', { tool_name: 'Bash', tool_input: {}, tool_use_id: 't3' })
    expect(events).toHaveLength(0)
  })

  it('PostToolUse → tool_result success; PostToolUseFailure → error', async () => {
    const { events, fire } = setup()
    await fire('SubagentStart', { agent_id: 'a1', agent_type: 'dev' })
    await fire('PostToolUse', { agent_id: 'a1', tool_name: 'Read', tool_input: {}, tool_response: 'x', tool_use_id: 't4' })
    await fire('PostToolUseFailure', { agent_id: 'a1', tool_name: 'Bash', tool_input: {}, tool_use_id: 't5', error: 'boom' })
    expect(events[1]).toMatchObject({ nodeId: 'sub:a1', payload: { type: 'tool_result', toolId: 't4', status: 'success' } })
    expect(events[2]).toMatchObject({ nodeId: 'sub:a1', payload: { type: 'tool_result', toolId: 't5', status: 'error' } })
  })

  it('strips the mcp__eyas__ prefix from tool names', async () => {
    const { events, fire } = setup()
    await fire('PreToolUse', { agent_id: 'a1', tool_name: 'mcp__eyas__search_memory', tool_input: {}, tool_use_id: 't6' })
    expect(events[0]?.payload).toMatchObject({ type: 'tool_started', name: 'search_memory' })
  })

  it('a throwing sink never breaks the SDK loop', async () => {
    const { hooks } = buildOrchestrationHooks({
      runId: 'r', parentNodeId: null,
      emit: () => { throw new Error('sink down') },
      seq: createRunSeq(),
    })
    const matcher = (hooks as any).SubagentStart[0]
    await expect(matcher.hooks[0]({ agent_id: 'a', agent_type: 'x' }, undefined, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ continue: true })
  })
})
