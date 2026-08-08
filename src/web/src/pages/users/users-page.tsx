import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Plus, Archive, ArchiveRestore } from 'lucide-react'
import { t, tOr } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface User {
  id: string
  username: string
  displayName: string
  role: string
  isRootOwner: boolean
  isAgent: boolean
  agentDefinitionId?: string | null
  status: string
  createdAt: string
}

const roleBadgeVariant = (role: string): 'default' | 'secondary' | 'outline' => {
  if (role === 'owner') return 'default'
  if (role === 'admin') return 'secondary'
  return 'outline'
}

type UsersView = 'active' | 'archived'

export default function UsersPage() {
  const [view, setView] = useState<UsersView>('active')
  const { data, refetch } = useApi<{ users: User[] }>(view === 'archived' ? '/users?status=archived' : '/users')
  const users = data?.users || []
  const navigate = useNavigate()
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Archive is a soft action (status -> 'archived'); the user can always be
  // restored later from the Archived view. Agent users and the root owner
  // are never offered this action (see the button visibility check below),
  // and the backend also enforces it server-side.
  const handleArchive = useCallback(async (user: User) => {
    if (!confirm(t('users.archiveConfirm', { name: user.displayName }))) return
    setActionInProgress(user.id)
    try {
      await api.delete(`/users/${user.id}`)
      refetch()
    } catch (err) {
      console.error('Failed to archive user:', err)
    } finally {
      setActionInProgress(null)
    }
  }, [refetch])

  const handleRestore = useCallback(async (user: User) => {
    setActionInProgress(user.id)
    try {
      await api.post(`/users/${user.id}/restore`)
      refetch()
    } catch (err) {
      console.error('Failed to restore user:', err)
    } finally {
      setActionInProgress(null)
    }
  }, [refetch])

  const handleCreateAgent = async () => {
    const result = await api.post<{ user: User; agentDefinitionId: string }>('/users/agents', {
      name: 'New Agent',
    })
    navigate({ to: '/agents/$agentId', params: { agentId: result.agentDefinitionId } })
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('users.title')} <ContextualHelp helpId="admin.users" /></h1>
          <p className="text-sm text-muted-foreground">{t('users.subtitle')}</p>
        </div>
        <Button size="sm" onClick={handleCreateAgent}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('users.newAgent')}
        </Button>
      </div>

      <div className="flex items-center rounded-lg border border-[var(--vibrancy-border)] overflow-hidden w-fit mb-4">
        <button
          type="button"
          onClick={() => setView('active')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            view === 'active'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          {t('users.viewActive')}
        </button>
        <button
          type="button"
          onClick={() => setView('archived')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            view === 'archived'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          {t('users.viewArchived')}
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--vibrancy-border)]">
              <th className="text-left p-3 section-label">{t('users.colUsername')}</th>
              <th className="text-left p-3 section-label">{t('users.colDisplayName')}</th>
              <th className="text-left p-3 section-label">{t('users.colRole')}</th>
              <th className="text-left p-3 section-label">{t('users.colType')}</th>
              <th className="text-left p-3 section-label">{t('common.status')}</th>
              <th className="text-left p-3 section-label">{t('users.colCreated')}</th>
              <th className="text-right p-3 section-label"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {view === 'archived' ? t('users.noArchived') : t('users.noUsers')}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-mono text-xs">{u.username}</td>
                  <td className="p-3">{u.displayName}</td>
                  <td className="p-3"><Badge variant={roleBadgeVariant(u.role)} className="text-[10px]">{u.role}</Badge></td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px]">{u.isAgent ? t('users.typeAgent') : t('users.typeHuman')}</Badge>
                    {u.isAgent && u.agentDefinitionId && (
                      <button
                        className="text-[10px] text-purple-400 hover:text-purple-300 ml-2"
                        onClick={() => navigate({ to: '/agents/$agentId', params: { agentId: u.agentDefinitionId! } })}
                      >
                        {t('users.aiConfig')}
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={u.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground'}>
                      {u.status === 'active' ? '●' : '○'} {tOr(`users.status.${u.status}`, u.status)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right">
                    {view === 'archived' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-primary hover:text-primary hover:bg-primary/10"
                        onClick={() => handleRestore(u)}
                        disabled={actionInProgress === u.id}
                        title={t('users.restoreTitle')}
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      !u.isRootOwner && !u.isAgent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleArchive(u)}
                          disabled={actionInProgress === u.id}
                          title={t('users.archiveTitle')}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
