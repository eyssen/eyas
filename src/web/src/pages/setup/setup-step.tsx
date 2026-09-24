import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, tOr } from './i18n'

interface StepField {
  name: string
  type: string
  label: string
  required: boolean
  placeholder?: string
}

interface SetupStepProps {
  step: { id: string; title: string; description: string; fields: StepField[] }
  onSubmit: (data: Record<string, string>) => Promise<void>
  isLast: boolean
}

export function SetupStep({ step, onSubmit, isLast }: SetupStepProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onSubmit(values)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  // Step title/description and field labels/placeholders originate in the
  // server-side step registry (always English). Translate them by stable
  // id/field-name key, falling back to the backend text when no translation
  // exists yet.
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{tOr(`step.${step.id}.title`, step.title)}</h2>
        <p className="text-sm text-muted-foreground">{tOr(`step.${step.id}.desc`, step.description)}</p>
      </div>

      {step.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={field.name}>{tOr(`field.${field.name}.label`, field.label)}</Label>
          <Input
            id={field.name}
            type={field.type === 'password' ? 'password' : 'text'}
            placeholder={field.placeholder ? tOr(`field.${field.name}.ph`, field.placeholder) : undefined}
            required={field.required}
            value={values[field.name] || ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
          />
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t('common.pleaseWait') : isLast ? t('common.complete') : t('common.continue')}
      </Button>
    </form>
  )
}
