import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Server, Plus, Pencil, Trash2 } from 'lucide-react'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t } from './i18n'

interface RemoteNode {
  id: string
  name: string
  host: string
  type: string
  capabilities: string[]
  status: string
  lastSeen: string | null
}

const statusColor: Record<string, string> = {
  online: 'text-emerald-500',
  offline: 'text-destructive',
  unknown: 'text-amber-500',
}

export default function NodesPage() {
  const { data, refetch } = useApi<{ nodes: RemoteNode[] }>('/nodes')
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<RemoteNode | null>(null)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [type, setType] = useState('ssh')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const nodes = data?.nodes || []

  const openCreate = () => {
    setEditing(null)
    setName('')
    setHost('')
    setType('ssh')
    setShowDialog(true)
  }

  const openEdit = (node: RemoteNode) => {
    setEditing(node)
    setName(node.name)
    setHost(node.host)
    setType(node.type)
    setShowDialog(true)
  }

  const handleSave = useCallback(async () => {
    if (!name || !host) return
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/nodes/${editing.id}`, { name, host, type })
      } else {
        await api.post('/nodes', { name, host, type })
      }
      setShowDialog(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }, [name, host, type, editing, refetch])

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id)
    try {
      await api.delete(`/nodes/${id}`)
      refetch()
    } finally {
      setDeleting(null)
    }
  }, [refetch])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('nodes.title')} <ContextualHelp helpId="admin.nodes" /></h1>
          <p className="text-sm text-muted-foreground">{t('nodes.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {nodes.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{t('nodes.count', { count: nodes.length })}</Badge>
          )}
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t('nodes.addNode')}
          </Button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('nodes.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {nodes.map((node) => (
            <div key={node.id} className="glass-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 mb-1">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{node.name}</span>
                  <span className={`h-2 w-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : node.status === 'offline' ? 'bg-destructive' : 'bg-amber-500'}`} />
                  <Badge variant="outline" className="text-[10px]">{node.type}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(node)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(node.id)}
                    disabled={deleting === node.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs font-mono text-muted-foreground ml-6">{node.host}</p>
              {node.lastSeen && (
                <p className="text-xs text-muted-foreground ml-6 mt-1">
                  {t('nodes.lastSeen', { time: new Date(node.lastSeen).toLocaleString() })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('nodes.editNode') : t('nodes.addNode')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('common.name')}</Label>
              <Input placeholder="my-node" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('nodes.host')}</Label>
              <Input placeholder="192.168.1.100:3100" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('nodes.type')}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="websocket">WebSocket</SelectItem>
                  <SelectItem value="tailscale">Tailscale</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={saving || !name || !host}>
              {saving ? t('nodes.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
