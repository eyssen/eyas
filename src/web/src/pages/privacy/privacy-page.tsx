// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ShieldCheck,
  ScanSearch,
  AlertTriangle,
  BarChart3,
  FileSearch,
  Eye,
  EyeOff,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface ScanResult {
  matches: Array<{
    type: string
    start: number
    end: number
    confidence: number
    scanner: string
    value: string
  }>
  blocked: boolean
  reason?: string
  warnings: string[]
  routeToLocal: boolean
  sanitizedText: string
}

interface PrivacyStats {
  totalScans: number
  totalMatches: number
  matchesByType: Record<string, number>
  scannerStats: Record<string, { scans: number; matches: number }>
}

const PII_TYPE_COLORS: Record<string, string> = {
  email: 'text-blue-500 border-blue-500/30',
  phone: 'text-emerald-500 border-emerald-500/30',
  ssn: 'text-red-500 border-red-500/30',
  credit_card: 'text-amber-500 border-amber-500/30',
  ip_address: 'text-purple-500 border-purple-500/30',
  name: 'text-cyan-500 border-cyan-500/30',
}

export default function PrivacyPage() {
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useApi<PrivacyStats>('/privacy/stats')
  const [scanText, setScanText] = useState('')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [showSanitized, setShowSanitized] = useState(false)

  const handleScan = useCallback(async () => {
    if (!scanText.trim()) return
    setIsScanning(true)
    setScanResult(null)
    try {
      const result = await api.post<ScanResult>('/privacy/scan', { text: scanText })
      setScanResult(result)
      refetchStats()
    } catch (err) {
      console.error('Scan failed:', err)
    } finally {
      setIsScanning(false)
    }
  }, [scanText, refetchStats])

  const stats = statsData

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('privacy.title')} <ContextualHelp helpId="admin.security" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('privacy.subtitle')}
          </p>
        </div>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="glass-card p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <ScanSearch className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider font-medium">{t('privacy.stat.totalScans')}</span>
            </div>
            <div className="text-2xl font-bold">{stats.totalScans}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider font-medium">{t('privacy.stat.piiDetected')}</span>
            </div>
            <div className="text-2xl font-bold text-amber-500">{stats.totalMatches}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider font-medium">{t('privacy.stat.piiTypes')}</span>
            </div>
            <div className="text-2xl font-bold">{Object.keys(stats.matchesByType).length}</div>
          </div>
        </div>
      )}

      {/* PII type breakdown */}
      {stats && Object.keys(stats.matchesByType).length > 0 && (
        <div className="glass-card p-4 mb-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
            {t('privacy.detectedPiiTypes')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(stats.matchesByType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between p-2 rounded-md bg-accent/30">
                <Badge variant="outline" className={`text-[10px] ${PII_TYPE_COLORS[type] ?? ''}`}>
                  {type}
                </Badge>
                <span className="text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scanner stats */}
      {stats && Object.keys(stats.scannerStats).length > 0 && (
        <div className="glass-card p-4 mb-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
            {t('privacy.scannerPerformance')}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--vibrancy-border)]">
                <th className="text-left p-2 section-label">{t('privacy.col.scanner')}</th>
                <th className="text-right p-2 section-label">{t('privacy.col.scans')}</th>
                <th className="text-right p-2 section-label">{t('privacy.col.matches')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.scannerStats).map(([name, s]) => (
                <tr key={name} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-2 font-mono text-xs">{name}</td>
                  <td className="p-2 text-right text-muted-foreground">{s.scans}</td>
                  <td className="p-2 text-right">{s.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual scan */}
      <div className="glass-card p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <FileSearch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('privacy.testScanner')}</span>
        </div>
        <textarea
          className="w-full bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[100px] resize-y mb-3"
          placeholder={t('privacy.scanPlaceholder')}
          value={scanText}
          onChange={(e) => setScanText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleScan} disabled={isScanning || !scanText.trim()}>
            <ScanSearch className="h-3.5 w-3.5 mr-1" />
            {isScanning ? t('privacy.scanning') : t('privacy.scanText')}
          </Button>
        </div>
      </div>

      {/* Scan results */}
      {scanResult && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('privacy.scanResults')}</span>
            </div>
            {scanResult.blocked && (
              <Badge variant="destructive" className="text-[10px]">
                {t('privacy.blocked')}
              </Badge>
            )}
            {scanResult.routeToLocal && (
              <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                {t('privacy.routeToLocal')}
              </Badge>
            )}
          </div>

          {scanResult.reason && (
            <div className="text-xs text-red-400 mb-2">{scanResult.reason}</div>
          )}

          {scanResult.warnings.length > 0 && (
            <div className="mb-3 space-y-1">
              {scanResult.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                  <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {scanResult.matches.length === 0 ? (
            <div className="text-xs text-emerald-500 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('privacy.noPii')}
            </div>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                {t('privacy.matchesFound', { count: scanResult.matches.length })}
              </div>
              <div className="space-y-1.5">
                {scanResult.matches.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-accent/30">
                    <Badge variant="outline" className={`text-[10px] ${PII_TYPE_COLORS[m.type] ?? ''}`}>
                      {m.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{m.value}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {t('privacy.position', { start: m.start, end: m.end })}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t('privacy.confidence', { value: (m.confidence * 100).toFixed(0) })}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {m.scanner}
                    </Badge>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Sanitized text toggle */}
          {scanResult.sanitizedText && scanResult.matches.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowSanitized(!showSanitized)}
              >
                {showSanitized ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showSanitized ? t('privacy.hideSanitized') : t('privacy.showSanitized')}
              </button>
              {showSanitized && (
                <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 mt-1 overflow-x-auto whitespace-pre-wrap">
                  {scanResult.sanitizedText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {statsLoading && !stats && (
        <p className="text-sm text-muted-foreground mt-4">{t('privacy.loading')}</p>
      )}
    </div>
  )
}
