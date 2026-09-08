import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { BOARD_ALL_PROJECTS_ID, useBoardStore } from '@/stores/board-store'
import { t } from './i18n'

interface BoardHeaderProps {
  projectName: string
  projects: { id: string; name: string; color: string | null }[]
  currentProjectId: string | null
  onProjectChange: (id: string) => void
}

export function BoardHeader({ projectName, projects, currentProjectId, onProjectChange }: BoardHeaderProps) {
  const [newTitle, setNewTitle] = useState('')
  const [showInput, setShowInput] = useState(false)
  const addConversation = useBoardStore(s => s.addConversation)

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    await addConversation(newTitle.trim())
    setNewTitle('')
    setShowInput(false)
  }

  void projectName

  return (
    <div className="flex items-center gap-3 mb-2">
      <select
        value={currentProjectId ?? BOARD_ALL_PROJECTS_ID}
        onChange={(e) => onProjectChange(e.target.value)}
        className="h-8 px-2 text-xs bg-transparent border border-border/40 rounded-md focus:outline-none focus:ring-1 focus:ring-ring font-semibold"
      >
        <option value={BOARD_ALL_PROJECTS_ID}>{t('board.projectAll')}</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <div className="flex-1" />

      {showInput ? (
        <div className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t('board.newConversationPlaceholder')}
            className="h-8 w-52 text-xs"
            autoFocus
          />
          <Button size="sm" className="h-8 text-xs" onClick={handleAdd} disabled={!newTitle.trim()}>{t('common.add')}</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowInput(false)}>{t('common.cancel')}</Button>
        </div>
      ) : (
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowInput(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('board.new')}
        </Button>
      )}
    </div>
  )
}
