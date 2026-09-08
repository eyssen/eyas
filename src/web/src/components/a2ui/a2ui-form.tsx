// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { A2UIForm as A2UIFormType } from '../../../../shared/a2ui-types'

interface A2UIFormProps {
  content: A2UIFormType
  onSubmit: (data: Record<string, unknown>) => void
}

export function A2UIForm({ content, onSubmit }: A2UIFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {}
    for (const field of content.fields) {
      if (field.defaultValue != null) {
        defaults[field.name] = field.defaultValue
      } else if (field.type === 'checkbox') {
        defaults[field.name] = false
      } else {
        defaults[field.name] = ''
      }
    }
    return defaults
  })

  function setValue(name: string, value: unknown) {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-medium text-foreground">{content.title}</p>

      {content.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={`a2ui-${field.name}`} className="text-sm">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>

          {field.type === 'text' && (
            <Input
              id={`a2ui-${field.name}`}
              type="text"
              placeholder={field.placeholder}
              required={field.required}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
            />
          )}

          {field.type === 'number' && (
            <Input
              id={`a2ui-${field.name}`}
              type="number"
              placeholder={field.placeholder}
              required={field.required}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setValue(field.name, e.target.valueAsNumber)}
            />
          )}

          {field.type === 'date' && (
            <Input
              id={`a2ui-${field.name}`}
              type="date"
              required={field.required}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
            />
          )}

          {field.type === 'textarea' && (
            <textarea
              id={`a2ui-${field.name}`}
              className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              placeholder={field.placeholder}
              required={field.required}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
            />
          )}

          {field.type === 'checkbox' && (
            <div className="flex items-center gap-2">
              <input
                id={`a2ui-${field.name}`}
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={Boolean(values[field.name])}
                onChange={(e) => setValue(field.name, e.target.checked)}
              />
            </div>
          )}

          {field.type === 'select' && (
            <Select
              value={String(values[field.name] ?? '')}
              onValueChange={(v) => setValue(field.name, v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={field.placeholder ?? 'Select...'} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ))}

      <Button type="submit" size="sm">
        {content.submitLabel ?? 'Submit'}
      </Button>
    </form>
  )
}
