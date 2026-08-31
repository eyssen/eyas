// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type SourceType = 'tasks' | 'git' | 'audit' | 'calendar' | 'email'

export interface ProactiveAlert {
  id: string
  type: 'reminder' | 'suggestion' | 'warning' | 'insight'
  title: string
  body: string
  source: SourceType
  priority: 'low' | 'normal' | 'high' | 'urgent'
  actionable: boolean
  action?: { type: string; data: Record<string, unknown> }
  createdAt: string
  readAt?: string
}

export interface LessonLearned {
  pattern: string
  solution: string
  frequency: number
  lastSeen: string
  savedToMemory: boolean
}
