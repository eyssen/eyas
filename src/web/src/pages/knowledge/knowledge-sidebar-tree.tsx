import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/stores/knowledge-store'
import { t } from './i18n'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TreeNodeData {
  id: string
  title: string
  slug: string
  icon: string | null
  children: TreeNodeData[]
}

// ─── Inline context menu ───────────────────────────────────────────────────────

interface ContextMenuProps {
  items: { label: string; danger?: boolean; onClick: () => void }[]
  onClose: () => void
}

function ContextMenu({ items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-0.5 min-w-[140px] rounded-[6px] border border-border bg-popover py-1 shadow-md"
    >
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          onClick={() => { item.onClick(); onClose() }}
          className={cn(
            'block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/60',
            item.danger ? 'text-destructive' : 'text-foreground'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ─── Move dialog ───────────────────────────────────────────────────────────────

interface MoveDialogProps {
  pageId: string
  spaceId: string
  spaces: { id: string; name: string }[]
  pageTree: Map<string, TreeNodeData[]>
  onClose: () => void
}

function MoveDialog({ pageId, spaceId, spaces, pageTree, onClose }: MoveDialogProps) {
  const { movePage } = useKnowledgeStore()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleMove = async (targetSpaceId: string, parentId: string | null) => {
    await movePage(pageId, spaceId, parentId)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-0.5 min-w-[160px] rounded-[6px] border border-border bg-popover py-1 shadow-md"
    >
      <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {t('knowledge.tree.moveTo')}
      </div>
      {spaces.map(space => (
        <div key={space.id}>
          <button
            type="button"
            onClick={() => handleMove(space.id, null)}
            className="block w-full px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent/60"
          >
            📁 {space.name} ({t('knowledge.tree.root')})
          </button>
          {(pageTree.get(space.id) ?? []).map(node => (
            node.id !== pageId && (
              <button
                key={node.id}
                type="button"
                onClick={() => handleMove(space.id, node.id)}
                className="block w-full px-6 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/60"
              >
                · {node.title}
              </button>
            )
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: TreeNodeData
  spaceId: string
  depth: number
}

function TreeNode({ node, spaceId, depth }: TreeNodeProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { spaces, pageTree, deletePage } = useKnowledgeStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  const pagePath = `/knowledge/${node.id}`
  const isActive = location.pathname === pagePath
  const hasChildren = node.children.length > 0

  const handleDelete = async () => {
    if (!confirm(t('knowledge.tree.deletePageConfirm', { title: node.title }))) return
    await deletePage(node.id, spaceId)
    if (location.pathname === pagePath) navigate({ to: '/knowledge' as any })
  }

  return (
    <>
      <div className="group relative flex items-center">
        <Link
          to={pagePath as any}
          className={cn(
            'flex flex-1 items-center gap-1 py-1 rounded-[5px] text-[11px] transition-colors',
            isActive
              ? 'bg-[var(--nav-active-bg)] text-foreground font-medium nav-active'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
          style={{ paddingLeft: `${12 + depth * 12}px`, paddingRight: '28px' }}
        >
          {hasChildren ? '▾' : '·'} {node.icon ?? ''} {node.title}
        </Link>

        {/* Page actions button */}
        <div className="absolute right-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => { setMenuOpen(v => !v); setMoveOpen(false) }}
            className="opacity-0 group-hover:opacity-100 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-opacity"
            title={t('knowledge.tree.pageActions')}
          >
            ⋯
          </button>
          {menuOpen && (
            <ContextMenu
              onClose={() => setMenuOpen(false)}
              items={[
                {
                  label: t('knowledge.tree.moveToAction'),
                  onClick: () => { setMenuOpen(false); setMoveOpen(true) },
                },
                {
                  label: t('knowledge.tree.delete'),
                  danger: true,
                  onClick: handleDelete,
                },
              ]}
            />
          )}
          {moveOpen && (
            <MoveDialog
              pageId={node.id}
              spaceId={spaceId}
              spaces={spaces}
              pageTree={pageTree}
              onClose={() => setMoveOpen(false)}
            />
          )}
        </div>
      </div>

      {node.children.map((child: TreeNodeData) => (
        <TreeNode key={child.id} node={child} spaceId={spaceId} depth={depth + 1} />
      ))}
    </>
  )
}

// ─── NewPageButton ─────────────────────────────────────────────────────────────

function NewPageButton({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate()
  const { createPage } = useKnowledgeStore()
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setIsCreating(true)
    const page = await createPage(spaceId, t('knowledge.untitled'))
    setIsCreating(false)
    if (page) navigate({ to: `/knowledge/${page.id}` as any })
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={isCreating}
      className="flex items-center gap-1 pl-7 pr-3 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-left"
    >
      {isCreating ? '...' : `+ ${t('knowledge.tree.newPage')}`}
    </button>
  )
}

// ─── SpaceRow ──────────────────────────────────────────────────────────────────

interface SpaceRowProps {
  space: { id: string; name: string; icon: string | null }
}

function SpaceRow({ space }: SpaceRowProps) {
  const { renameSpace, deleteSpace } = useKnowledgeStore()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleRename = () => {
    const newName = prompt(t('knowledge.tree.renameSpacePrompt'), space.name)
    if (newName && newName.trim() && newName.trim() !== space.name) {
      renameSpace(space.id, newName.trim())
    }
  }

  const handleDelete = () => {
    if (!confirm(t('knowledge.tree.deleteSpaceConfirm', { name: space.name }))) return
    deleteSpace(space.id)
  }

  return (
    <div className="group relative flex items-center gap-1 pl-7 pr-2 py-1 text-[11px] text-muted-foreground font-medium">
      <span className="flex-1 truncate">{space.icon ?? '📁'} {space.name}</span>

      <button
        type="button"
        onClick={() => setMenuOpen(v => !v)}
        className="opacity-0 group-hover:opacity-100 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-opacity"
        title={t('knowledge.tree.spaceActions')}
      >
        ⋯
      </button>

      {menuOpen && (
        <ContextMenu
          onClose={() => setMenuOpen(false)}
          items={[
            { label: t('knowledge.tree.rename'), onClick: handleRename },
            { label: t('knowledge.tree.delete'), danger: true, onClick: handleDelete },
          ]}
        />
      )}
    </div>
  )
}

// ─── Flatten tree helper ───────────────────────────────────────────────────────

interface FlatPage {
  id: string
  title: string
  icon: string | null
  spaceId: string
}

function flattenTree(nodes: TreeNodeData[], spaceId: string): FlatPage[] {
  const result: FlatPage[] = []
  for (const node of nodes) {
    result.push({ id: node.id, title: node.title, icon: node.icon, spaceId })
    result.push(...flattenTree(node.children, spaceId))
  }
  return result
}

// ─── KnowledgeSidebarTree ─────────────────────────────────────────────────────

export function KnowledgeSidebarTree() {
  const { spaces, pageTree, fetchSpaces, createSpace } = useKnowledgeStore()
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchSpaces()
  }, [fetchSpaces])

  const handleCreateSpace = () => {
    const name = prompt(t('knowledge.tree.newSpacePrompt'))
    if (name && name.trim()) createSpace(name.trim())
  }

  // Flat filtered results when searching
  const searchResults: FlatPage[] = searchQuery.trim()
    ? spaces.flatMap(space => flattenTree(pageTree.get(space.id) ?? [], space.id))
        .filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : []

  return (
    <div className="flex flex-col gap-0.5 mt-0.5">
      {/* Header with "+" button */}
      <div className="group flex items-center pl-4 pr-2 py-0.5">
        <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          {t('knowledge.tree.title')}
        </span>
        <button
          type="button"
          onClick={handleCreateSpace}
          className="opacity-0 group-hover:opacity-100 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-opacity"
          title={t('knowledge.tree.newSpace')}
        >
          +
        </button>
      </div>

      {/* Search input */}
      <div className="px-3 pb-1">
        <input
          type="text"
          placeholder={t('knowledge.tree.searchPages')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-2 py-1 text-[11px] bg-transparent border border-border rounded-[5px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Flat search results or full tree */}
      {searchQuery.trim() ? (
        <div className="flex flex-col gap-0.5">
          {searchResults.length === 0 ? (
            <div className="px-4 py-1 text-[11px] text-muted-foreground">{t('common.noResults')}</div>
          ) : (
            searchResults.map(page => (
              <Link
                key={page.id}
                to={`/knowledge/${page.id}` as any}
                className="flex items-center gap-1 px-4 py-1 rounded-[5px] text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                {page.icon ?? '·'} {page.title}
              </Link>
            ))
          )}
        </div>
      ) : (
        spaces.map(space => {
          const tree = pageTree.get(space.id) ?? []
          return (
            <div key={space.id}>
              <SpaceRow space={space} />
              {tree.map(node => (
                <TreeNode key={node.id} node={node} spaceId={space.id} depth={1} />
              ))}
              <NewPageButton spaceId={space.id} />
            </div>
          )
        })
      )}
    </div>
  )
}
