// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Depth of research — shallow uses fewer queries, deep is exhaustive */
export type ResearchDepth = 'shallow' | 'deep'

/** Status of a research report */
export type ResearchStatus = 'pending' | 'searching' | 'evaluating' | 'synthesizing' | 'complete' | 'error'

/** A single web search result */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** An evaluated source with relevance score */
export interface EvaluatedSource {
  title: string
  url: string
  snippet: string
  relevance: number
  extractedContent?: string
}

/** A section of the final report */
export interface ReportSection {
  title: string
  content: string
}

/** The full research report */
export interface ResearchReport {
  id: string
  query: string
  depth: ResearchDepth
  status: ResearchStatus
  sections: ReportSection[]
  sources: Array<{ title: string; url: string; relevance: number }>
  error?: string
  createdAt: string
  completedAt?: string
}

/** Options for starting a research workflow */
export interface ResearchOptions {
  query: string
  depth?: ResearchDepth
}

/** Step progress callback */
export interface ResearchProgress {
  step: number
  totalSteps: number
  label: string
  detail?: string
}
