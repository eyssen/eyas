// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MediaSettings } from './types.js'

export function assertBudget(input: {
  providerId: string
  settings: MediaSettings
  spentDaily: number
  spentMonthly: number
}): void {
  const caps = input.settings.budget[input.providerId]
  if (!caps) return

  if (caps.dailyCredits != null && input.spentDaily >= caps.dailyCredits) {
    throw new Error(`budget: daily credit cap exceeded for ${input.providerId}`)
  }
  if (caps.monthlyCredits != null && input.spentMonthly >= caps.monthlyCredits) {
    throw new Error(`budget: monthly credit cap exceeded for ${input.providerId}`)
  }
}
