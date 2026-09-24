// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The effort of a scheduled agent run (E6): the shared EffortSelect in the
// scheduler's create form and job drawer. It lists only the rungs the
// agent's model offers (useEffortOptions by agent), and Auto says what the
// run falls back to — the agent's own effort ("Auto · Low (colleague)"),
// else the model default. The job keeps a rung in handlerConfig.effort;
// Auto keeps no key, and the run then takes the agent's effort
// (modules/scheduler/agent-run-handler.ts). The gateway clamps the level to
// the model the run lands on.

import { Label } from '@/components/ui/label'
import { EffortSelect } from '@/components/effort-select'
import { useEffortOptions } from '@/hooks/use-effort-options'
import { effortFromSelect, type EffortIntent, type EffortLevel } from '@/lib/effort-options'
import { t } from './i18n'

/** The agent a scheduled run speaks as, as the agent list returns it. */
export interface EffortAgent {
  id: string
  effort?: string | null
}

/** What Auto means for a run of this agent: its own effort, when it has one. */
export function agentEffortIntent(agent: EffortAgent | null | undefined): EffortIntent | null {
  const level = typeof agent?.effort === 'string' ? effortFromSelect(agent.effort) : null
  return level ? { level, source: 'agent' } : null
}

function configObject(handlerConfig: string | null | undefined): Record<string, unknown> | null {
  if (!handlerConfig) return null
  try {
    const value: unknown = JSON.parse(handlerConfig)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The agent and effort a stored agent_run handlerConfig names (null effort = Auto). */
export function agentRunConfigOf(handlerConfig: string | null | undefined): { agentId: string | null; effort: EffortLevel | null } {
  const cfg = configObject(handlerConfig)
  const agentId = typeof cfg?.agentId === 'string' && cfg.agentId.trim() ? cfg.agentId.trim() : null
  const effort = typeof cfg?.effort === 'string' ? effortFromSelect(cfg.effort) : null
  return { agentId, effort }
}

/**
 * The stored handlerConfig with its effort replaced — every other key kept;
 * Auto removes the key. null when the stored config is not a JSON object
 * (nothing to edit safely).
 */
export function withAgentRunEffort(handlerConfig: string | null | undefined, effort: EffortLevel | null): string | null {
  const cfg = configObject(handlerConfig)
  if (!cfg) return null
  const next: Record<string, unknown> = { ...cfg }
  if (effort) next.effort = effort
  else delete next.effort
  return JSON.stringify(next)
}

/** A new agent_run job's handlerConfig; Auto adds no effort key. */
export function agentRunHandlerConfig(input: {
  agentId: string
  prompt: string
  title: string
  effort: EffortLevel | null
}): string {
  return JSON.stringify({
    agentId: input.agentId,
    prompt: input.prompt,
    title: input.title,
    ...(input.effort ? { effort: input.effort } : {}),
  })
}

export interface AgentRunEffortFieldProps {
  agent: EffortAgent
  value: EffortLevel | null
  onChange: (value: EffortLevel | null) => void
  disabled?: boolean
}

export function AgentRunEffortField({ agent, value, onChange, disabled }: AgentRunEffortFieldProps) {
  const { options } = useEffortOptions({ agentId: agent.id })
  return (
    <div className="space-y-1">
      <Label className="text-[10px]">{t('common.effort.label')}</Label>
      <EffortSelect
        variant="form"
        value={value}
        options={options}
        inherited={agentEffortIntent(agent)}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
