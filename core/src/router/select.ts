import {
  DEFAULT_CLASS_ORDER,
  type HaloConfig,
  type TaskClass,
  type Tier,
} from '../config/schema.js'
import type { ModelEntry } from '../providers/registry.js'

export interface Selection {
  entry: ModelEntry
  taskClass: TaskClass
  reason: string
}

/**
 * Pick a model for a task class. Walks the tier order for the class
 * (config override first, then defaults) across available models.
 * An explicit overrideRef always wins if that model is available.
 */
export function selectModel(
  taskClass: TaskClass,
  models: readonly ModelEntry[],
  config: HaloConfig,
  overrideRef?: string,
  exhausted: ReadonlySet<string> = new Set(),
): Selection {
  const available = models.filter((m) => m.available)
  if (available.length === 0) {
    throw new Error('No models available — no provider has a usable API key or local endpoint')
  }

  if (overrideRef) {
    // Explicit choice wins even over an exhausted budget — the user pays knowingly.
    const entry = available.find((m) => m.ref === overrideRef)
    if (!entry) throw new Error(`Requested model "${overrideRef}" is not available`)
    return { entry, taskClass, reason: 'user override' }
  }

  const order: readonly Tier[] =
    config.routing.classOrder[taskClass] ?? DEFAULT_CLASS_ORDER[taskClass]

  const withinBudget = available.filter((m) => !exhausted.has(m.provider))
  const skipped = available.length - withinBudget.length
  const budgetNote = skipped > 0 ? `; ${skipped} model(s) skipped, budget exhausted` : ''

  const capable = withinBudget.filter((m) => m.classes.includes(taskClass))
  for (const tier of order) {
    const entry = capable.find((m) => m.tier === tier)
    if (entry) {
      return { entry, taskClass, reason: `class=${taskClass} → tier=${tier}${budgetNote}` }
    }
  }

  // Nothing declares this class: degrade gracefully to any usable model.
  const fallback = withinBudget[0] ?? available[0]!
  return { entry: fallback, taskClass, reason: `no model declares class=${taskClass}; fallback` }
}
