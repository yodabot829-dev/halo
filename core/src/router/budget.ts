import type { HaloConfig } from '../config/schema.js'
import type { Meter } from '../meter/meter.js'

export interface BudgetStatus {
  provider: string
  monthlyTokens: number | null
  usedTokens: number
  /** null = unmetered (flat subscription / local). */
  remainingTokens: number | null
}

export function monthStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/** Burn-down per provider for the current calendar month. */
export function budgetStatus(config: HaloConfig, meter: Meter, now: Date): BudgetStatus[] {
  const used = meter.tokensSince(monthStart(now))
  return Object.keys(config.providers).map((provider) => {
    const monthly = config.budgets[provider]?.monthlyTokens ?? null
    const usedTokens = used.get(provider) ?? 0
    return {
      provider,
      monthlyTokens: monthly,
      usedTokens,
      remainingTokens: monthly === null ? null : Math.max(0, monthly - usedTokens),
    }
  })
}

/** Providers whose declared budget is exhausted — skipped by auto-routing. */
export function exhaustedProviders(statuses: readonly BudgetStatus[]): Set<string> {
  return new Set(
    statuses.filter((s) => s.remainingTokens !== null && s.remainingTokens <= 0).map((s) => s.provider),
  )
}
