import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Secret { id: string; name: string; scope: string; module: string | null; createdAt: string }

export default function SecretsPage() {
  const [scope, setScope] = useState('system')
  const { data, refetch } = useApi<{ secrets: Secret[] }>(`/secrets?scope=${scope}`)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newScope, setNewScope] = useState('system')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const secrets = data?.secrets || []

  const handleAdd = async () => {
    if (!newName || !newValue) return
    setSaving(true)
    try {
      await api.post('/secrets', { name: newName, scope: newScope, value: newValue })
      setShowAdd(false)
      setNewName('')
      setNewValue('')
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (name: string) => {
    setDeleting(name)
    try {
      await api.delete(`/secrets/${name}?scope=${scope}`)
      refetch()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('secrets.title')} <ContextualHelp helpId="admin.secrets" /></h1>
          <p className="text-sm text-muted-foreground">{t('secrets.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> {t('secrets.add')}
        </Button>
      </div>

      {/* Scope filter */}
      <div className="flex gap-2 mb-4">
        {['system', 'user', 'agent'].map((s) => (
          <Button key={s} variant={scope === s ? 'secondary' : 'ghost'} size="sm" onClick={() => setScope(s)}>
            {t(`secrets.scope.${s}`)}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--vibrancy-border)]">
              <th className="text-left p-3 section-label">{t('common.name')}</th>
              <th className="text-left p-3 section-label">{t('secrets.colScope')}</th>
              <th className="text-left p-3 section-label">{t('secrets.colModule')}</th>
              <th className="text-left p-3 section-label">{t('secrets.colCreated')}</th>
              <th className="text-right p-3 section-label">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {secrets.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">{t('secrets.empty')}</td></tr>
            ) : (
              secrets.map((s) => (
                <tr key={s.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-mono text-xs">{s.name}</td>
                  <td className="p-3"><Badge variant="outline" className="text-[10px]">{t(`secrets.scope.${s.scope}`)}</Badge></td>
                  <td className="p-3 text-muted-foreground">{s.module || '—'}</td>
                  <td className="p-3 text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s.name)}
                      disabled={deleting === s.name}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('secrets.add')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('common.name')}</Label>
              <Input placeholder={t('secrets.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('secrets.colScope')}</Label>
              <Select value={newScope} onValueChange={setNewScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t('secrets.scope.system')}</SelectItem>
                  <SelectItem value="user">{t('secrets.scope.user')}</SelectItem>
                  <SelectItem value="agent">{t('secrets.scope.agent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('secrets.value')}</Label>
              <Input type="password" placeholder={t('secrets.valuePlaceholder')} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAdd} disabled={saving || !newName || !newValue}>
              {saving ? t('secrets.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
