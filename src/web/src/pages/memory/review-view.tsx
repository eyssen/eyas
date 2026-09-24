import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { t } from './i18n'

interface SkillCandidate {
  id: string
  sessionId: string
  slug: string
  rationale: string
  toolCallCount: number
  proposedAt: number
  status: string
}

interface WikiProposal {
  id: string
  clientId: string
  pagePath: string
  summary: string
  proposedBody: string
  proposedAt: number
  status: string
}

export default function MemoryReviewView() {
  const [skills, setSkills] = useState<SkillCandidate[]>([])
  const [wiki, setWiki] = useState<WikiProposal[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, w] = await Promise.all([
        api.get<{ candidates: SkillCandidate[] }>('/memory/review/skill-candidates?status=pending'),
        api.get<{ proposals: WikiProposal[] }>('/memory/review/wiki-proposals?status=pending'),
      ])
      setSkills(s.candidates ?? [])
      setWiki(w.proposals ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const review = async (kind: 'skill' | 'wiki', id: string, status: string) => {
    const endpoint = kind === 'skill'
      ? `/memory/review/skill-candidates/${id}`
      : `/memory/review/wiki-proposals/${id}`
    await api.post(endpoint, { status })
    await load()
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('memory.review.loading')}</p>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium mb-3">{t('memory.review.skillCandidates', { count: skills.length })}</h2>
        {skills.length === 0 && <p className="text-xs text-muted-foreground italic">{t('memory.review.noneSkill')}</p>}
        <div className="space-y-2">
          {skills.map(s => (
            <div key={s.id} className="p-4 bg-card border border-border rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.slug}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{t('memory.review.session', { id: s.sessionId.slice(0, 12) })}</div>
                  <p className="text-xs text-muted-foreground mt-2">{s.rationale}</p>
                  <div className="text-[10px] text-muted-foreground mt-2">{t('memory.review.toolCalls', { count: s.toolCallCount, date: new Date(s.proposedAt).toLocaleString() })}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => review('skill', s.id, 'approved')}
                    className="text-xs px-3 py-1 rounded bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                  >
                    {t('memory.review.approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => review('skill', s.id, 'rejected')}
                    className="text-xs px-3 py-1 rounded bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    {t('memory.review.reject')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-3">{t('memory.review.wikiProposals', { count: wiki.length })}</h2>
        {wiki.length === 0 && <p className="text-xs text-muted-foreground italic">{t('memory.review.noneWiki')}</p>}
        <div className="space-y-2">
          {wiki.map(w => (
            <div key={w.id} className="p-4 bg-card border border-border rounded-lg">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{w.pagePath}</div>
                  <div className="text-[10px] text-muted-foreground">{t('memory.review.client', { clientId: w.clientId })}</div>
                  <p className="text-xs mt-2">{w.summary}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => review('wiki', w.id, 'applied')}
                    className="text-xs px-3 py-1 rounded bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                  >
                    {t('memory.review.apply')}
                  </button>
                  <button
                    type="button"
                    onClick={() => review('wiki', w.id, 'rejected')}
                    className="text-xs px-3 py-1 rounded bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    {t('memory.review.reject')}
                  </button>
                </div>
              </div>
              <pre className="text-[10px] text-muted-foreground bg-accent/30 rounded-md p-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap">{w.proposedBody}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
