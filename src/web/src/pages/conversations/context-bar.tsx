interface ContextBarProps {
  tokensUsed: number
  contextWindow: number
}

export function ContextBar({ tokensUsed, contextWindow }: ContextBarProps) {
  if (contextWindow <= 0) return null
  const pct = Math.min((tokensUsed / contextWindow) * 100, 100)
  const color = pct < 50 ? 'bg-emerald-500' : pct < 75 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div
      className="w-full h-1.5 bg-accent/30 rounded-t-xl overflow-hidden"
      title={`${tokensUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${pct.toFixed(1)}%)`}
    >
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  )
}
