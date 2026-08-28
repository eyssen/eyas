// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { Component, type ReactNode } from 'react'
import { t } from './i18n'

/**
 * One module fault must not white out the landing page: the boundary is
 * per-tile, so a 500 from /costops/summary shows "Unavailable" on the Cost
 * tile while the other eight keep working.
 */
export class WidgetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return <div className="glass-card p-3 text-xs text-muted-foreground">{t('home.widget.error')}</div>
    }
    return this.props.children
  }
}
