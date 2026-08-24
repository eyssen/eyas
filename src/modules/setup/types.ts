export interface SetupField {
  name: string
  type: 'text' | 'password' | 'email' | 'toggle'
  label: string
  required: boolean
  placeholder?: string
  defaultValue?: string | boolean
}

export interface SetupStepDefinition {
  id: string
  module: string
  title: string
  description: string
  required: boolean
  order: number
  fields: SetupField[]
  onComplete(data: Record<string, unknown>): Promise<void>
}

export interface SetupStep {
  id: string
  module: string
  title: string
  description: string
  required: boolean
  order: number
  fields: SetupField[]
  status: 'pending' | 'completed' | 'skipped'
  completedAt: string | null
}

export interface SetupRegistry {
  registerStep(step: SetupStepDefinition): void
  getSteps(): SetupStep[]
  getStep(id: string): SetupStep | undefined
  isComplete(): boolean
  completeStep(id: string, data: Record<string, unknown>): Promise<void>
  skipStep(id: string): Promise<void>
}
