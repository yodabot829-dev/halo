import type { TaskClass } from '../config/schema.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const CODE_PATTERNS =
  /```|\bfunction\b|\bconst\b|\bimport\b|\bdef\b|\bclass\b|\brefactor\b|\bdebug\b|\bstack trace\b|\bcompile\b|\bunit test\b|\btypescript\b|\bpython\b|\bsql\b/i

const SUMMARISE_PATTERNS = /\bsummari[sz]e\b|\btl;?dr\b|\bcondense\b|\bkey points\b|\bdigest\b/i

const REASON_PATTERNS =
  /\bwhy\b|\bprove\b|\barchitect\b|\bdesign\b|\btrade-?offs?\b|\bplan\b|\bstrategy\b|\banaly[sz]e\b|\bcompare\b|\bevaluate\b/i

const REASON_LENGTH_THRESHOLD = 2000

/**
 * Heuristic v0 task classifier. Deliberately simple and fully deterministic —
 * the router only needs a coarse class; the user can always override the model.
 */
export function classify(messages: readonly ChatMessage[], hasImage = false): TaskClass {
  if (hasImage) return 'vision'

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const text = lastUser?.content ?? ''

  if (SUMMARISE_PATTERNS.test(text)) return 'summarise'
  if (CODE_PATTERNS.test(text)) return 'code'
  if (REASON_PATTERNS.test(text) || text.length > REASON_LENGTH_THRESHOLD) return 'reason'
  return 'chat'
}
