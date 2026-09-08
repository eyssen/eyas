// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useSearchStore, SEARCH_COLLECTIONS } from '@/stores/search-store'
import { cn } from '@/lib/utils'
import { MessageSquare, FileCode, BookOpen, File } from 'lucide-react'

const ICONS: Record<string, typeof FileCode> = {
  conversations: MessageSquare,
  code: FileCode,
  docs: BookOpen,
  files: File,
}

export function SearchFilters({ compact }: { compact?: boolean }) {
  const { enabledCollections, toggleCollection, query, search } = useSearchStore()

  return (
    <div className={cn('flex items-center gap-1.5', compact ? 'px-4 py-1.5' : 'gap-2')}>
      {SEARCH_COLLECTIONS.map(({ id, label }) => {
        const Icon = ICONS[id] ?? File
        const checked = enabledCollections[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => { toggleCollection(id); if (query.trim()) setTimeout(() => search(query), 50) }}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              checked
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30',
            )}
          >
            <Icon className="h-3 w-3" />
            {!compact && label}
            {compact && <span className="hidden sm:inline">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
