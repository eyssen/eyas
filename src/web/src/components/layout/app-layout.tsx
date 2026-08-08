import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { SearchBar } from './search-bar'
import { StatusBar } from './status-bar'

interface AppLayoutProps {
  children: ReactNode
  /** Skip the default p-6 padding on <main> (e.g. for full-bleed pages) */
  noPadding?: boolean
}

export function AppLayout({ children, noPadding }: AppLayoutProps) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className={`flex-1 overflow-auto${noPadding ? '' : ' p-6'}`}>{children}</main>
      </div>
      <StatusBar />
      <SearchBar />
    </div>
  )
}
