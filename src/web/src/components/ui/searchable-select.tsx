// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export interface SearchableSelectOption {
  value: string
  label: string
  group?: string
}

interface SearchableSelectProps {
  value: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchableSelect({ value, options, onChange, placeholder = 'Select...', className = '' }: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, openUp: false })

  const selectedLabel = options.find(o => o.value === value)?.label ?? value

  const filtered = search
    ? options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        o.value.toLowerCase().includes(search.toLowerCase())
      )
    : options

  const handleSelect = useCallback((val: string) => {
    onChange(val)
    setOpen(false)
    setSearch('')
  }, [onChange])

  // Position dropdown below or above trigger depending on available space
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 220 // max-h-48 (192px) + search input (~28px)
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < dropdownHeight && rect.top > dropdownHeight
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      openUp,
    })
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    <div className={className}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="h-7 w-full px-2 text-xs bg-accent/30 border border-border/50 rounded-md flex items-center justify-between gap-1 font-mono text-left truncate"
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
      </button>

      {/* Dropdown via portal */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] glass-card border border-border/50 rounded-md shadow-lg overflow-hidden"
          style={pos.openUp
            ? { bottom: window.innerHeight - pos.top, left: pos.left, width: pos.width }
            : { top: pos.top, left: pos.left, width: pos.width }
          }
        >
          {/* Search input */}
          <div className="p-1.5 border-b border-border/30">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full h-6 px-2 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setOpen(false); setSearch('') }
                if (e.key === 'Enter' && filtered.length > 0) handleSelect(filtered[0].value)
              }}
            />
          </div>
          {/* Options */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
            ) : (
              (() => {
                const items = filtered.slice(0, 50)
                const hasGroups = items.some(o => o.group)
                if (!hasGroups) {
                  return items.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => handleSelect(opt.value)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors truncate ${opt.value === value ? 'bg-accent/30 text-foreground' : 'text-muted-foreground'}`}
                    >{opt.label}</button>
                  ))
                }
                // Grouped rendering
                const groups: { group: string; items: typeof items }[] = []
                let currentGroup: string | null = null
                for (const opt of items) {
                  const g = opt.group || ''
                  if (g !== currentGroup || groups.length === 0) {
                    groups.push({ group: g, items: [] })
                    currentGroup = g
                  }
                  groups[groups.length - 1].items.push(opt)
                }
                return groups.map((g) => (
                  <div key={g.group || '_ungrouped'}>
                    {g.group && (
                      <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider bg-accent/10 border-t border-border/20 first:border-t-0">
                        {g.group}
                      </div>
                    )}
                    {g.items.map((opt) => (
                      <button key={opt.value} type="button" onClick={() => handleSelect(opt.value)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors truncate ${opt.value === value ? 'bg-accent/30 text-foreground' : 'text-muted-foreground'}`}
                      >{opt.label}</button>
                    ))}
                  </div>
                ))
              })()
            )}
            {filtered.length > 50 && (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/30">
                {filtered.length - 50} more — type to filter
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
