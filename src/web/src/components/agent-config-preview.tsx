// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bot, Check, Loader2, Pencil, Shield, Wrench, Target, Cpu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

export interface AgentConfig {
  id?: string
  name: string
  role: string
  description?: string
  goal?: string
  backstory?: string
  tier?: 'primary' | 'team' | 'specialist'
  agentType?: string
  systemPrompt?: string
  capabilities?: string[]
  tools?: string[]
  constraints?: string[]
  model?: string
  maxTurns?: number
  source?: string
}

interface AgentConfigPreviewProps {
  config: AgentConfig
  onModify?: () => void
}

const tierColors: Record<string, string> = {
  primary: 'text-purple-400 border-purple-400/30',
  team: 'text-blue-400 border-blue-400/30',
  specialist: 'text-muted-foreground',
}

export function AgentConfigPreview({ config, onModify }: AgentConfigPreviewProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleCreate = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      const payload = {
        id: config.id || `agent-${Date.now()}`,
        name: config.name,
        role: config.role,
        description: config.description || '',
        goal: config.goal || '',
        backstory: config.backstory || '',
        tier: config.tier || 'specialist',
        agentType: config.agentType || 'assistant',
        systemPrompt: config.systemPrompt || '',
        capabilities: config.capabilities || [],
        tools: config.tools || [],
        constraints: config.constraints || [],
        model: config.model || '',
        maxTurns: config.maxTurns || 10,
        source: 'user',
      }
      const result = await api.post<{ agent: { id: string } }>('/agents', payload)
      setStatus('success')
      setTimeout(() => {
        navigate({ to: '/agents/$agentId', params: { agentId: result.agent.id } })
      }, 600)
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err?.message || 'Failed to create agent')
    }
  }, [config, navigate])

  const tier = config.tier || 'specialist'
  const tools = config.tools || []
  const constraints = config.constraints || []

  return (
    <div className="glass-card p-5 my-3 max-w-lg">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Bot className="h-5 w-5 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{config.name}</span>
            <Badge variant="outline" className={`text-[10px] ${tierColors[tier] || ''}`}>
              {tier}
            </Badge>
            {config.agentType && (
              <Badge variant="outline" className="text-[10px]">
                {config.agentType}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{config.role}</p>
        </div>
      </div>

      {/* Goal */}
      {config.goal && (
        <div className="flex items-start gap-2 mb-3">
          <Target className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">{config.goal}</p>
        </div>
      )}

      {/* Description */}
      {config.description && (
        <p className="text-xs text-muted-foreground/80 mb-3">{config.description}</p>
      )}

      {/* Tools */}
      {tools.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wrench className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tools</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {tools.map((tool) => (
              <Badge key={tool} variant="secondary" className="text-[10px]">
                {tool}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Constraints */}
      {constraints.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Constraints</span>
          </div>
          <ul className="space-y-0.5 pl-4">
            {constraints.map((c, i) => (
              <li key={i} className="text-[11px] text-muted-foreground list-disc">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Model */}
      {config.model && (
        <div className="flex items-center gap-1.5 mb-4 text-[10px] text-muted-foreground">
          <Cpu className="h-3 w-3" />
          <span>{config.model}</span>
          {config.maxTurns && <span className="ml-2">· {config.maxTurns} max turns</span>}
        </div>
      )}

      {/* Error message */}
      {status === 'error' && (
        <p className="text-xs text-destructive mb-3">{errorMsg}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={status === 'loading' || status === 'success'}
        >
          {status === 'loading' ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating...</>
          ) : status === 'success' ? (
            <><Check className="h-3.5 w-3.5 mr-1.5" /> Created</>
          ) : (
            'Create Agent'
          )}
        </Button>
        {onModify && (
          <Button size="sm" variant="outline" onClick={onModify} disabled={status === 'loading'}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Modify
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Extracts an agent-config JSON from a markdown code block tagged with `agent-config`.
 * Returns the parsed AgentConfig if valid, or null if not found / invalid.
 */
export function tryParseAgentConfig(content: string): AgentConfig | null {
  const regex = /```agent-config\s*\n([\s\S]*?)\n```/
  const match = regex.exec(content)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[1])
    // Validate required fields
    if (typeof parsed.name !== 'string' || !parsed.name.trim()) return null
    if (typeof parsed.role !== 'string' || !parsed.role.trim()) return null
    return parsed as AgentConfig
  } catch {
    return null
  }
}
