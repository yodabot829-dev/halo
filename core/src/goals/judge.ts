import { generateText } from 'ai'
import type { HaloConfig } from '../config/schema.js'
import type { Meter } from '../meter/meter.js'
import { providerCallOptions } from '../providers/options.js'
import type { ModelSource } from '../providers/registry.js'
import { budgetStatus, exhaustedProviders } from '../router/budget.js'
import { selectModel } from '../router/select.js'
import type { Goal } from './goal-file.js'
import type { Judge, Verdict } from './engine.js'

// Distinct lenses so the panel catches failure modes a single reviewer misses.
const LENSES = [
  { key: 'literal', angle: 'Does the output literally satisfy EACH success criterion, word for word? Be pedantic.' },
  { key: 'evidence', angle: 'Is there concrete EVIDENCE (files, commands, results) that the work was actually done — not merely claimed?' },
  { key: 'skeptic', angle: 'Play devil’s advocate: assume the work is incomplete. What is the strongest reason to REJECT it?' },
] as const

interface OneVerdict {
  met: boolean
  feedback: string
}

async function judgeOnce(
  registry: ModelSource,
  config: HaloConfig,
  meter: Meter,
  goal: Goal,
  output: string,
  angle: string,
): Promise<OneVerdict> {
  const exhausted = exhaustedProviders(budgetStatus(config, meter, new Date()))
  // claude-code is a CLI chat bridge, not an API model — registry.resolve() throws on it.
  // Judging needs generateText(), so it must never be selected here (unlike chat.ts, which
  // branches to streamClaudeCodeChat for this provider).
  const resolvable = registry.list().filter((m) => config.providers[m.provider]?.kind !== 'claude-code')
  const selection = selectModel('reason', resolvable, config, undefined, exhausted)
  const prompt = [
    'You are a strict reviewer for a goal. Apply this lens:',
    angle,
    `## Objective\n${goal.objective}`,
    `## Success criteria\n${goal.criteria.map((c) => `- ${c}`).join('\n')}`,
    `## Executor report\n${output.slice(-6000)}`,
    'Reply with ONLY a JSON object: {"met": true|false, "feedback": "<specific to your lens>"}',
  ].join('\n\n')

  const result = await generateText({
    model: registry.resolve(selection.entry.ref),
    prompt,
    maxOutputTokens: 500,
    providerOptions: providerCallOptions(config, selection.entry.provider),
  })
  meter.record({
    provider: selection.entry.provider,
    model: selection.entry.modelId,
    taskClass: 'goal-judge',
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    ok: true,
  })

  const match = result.text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { met?: unknown; feedback?: unknown }
      return {
        met: parsed.met === true,
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : result.text.slice(0, 400),
      }
    } catch {
      // fall through
    }
  }
  return { met: false, feedback: `Unparseable reviewer reply: ${result.text.slice(0, 200)}` }
}

/** Single-reviewer verdict. */
export function makeLlmJudge(registry: ModelSource, config: HaloConfig, meter: Meter): Judge {
  return (goal, output) =>
    judgeOnce(registry, config, meter, goal, output, LENSES[0].angle)
}

/** Panel verdict: three lenses vote; a goal passes only on unanimous approval,
 * and rejection feedback aggregates every dissent. Catches plausible-but-wrong
 * completions a single judge would wave through. */
export function makePanelJudge(registry: ModelSource, config: HaloConfig, meter: Meter): Judge {
  return async (goal, output): Promise<Verdict> => {
    const verdicts = await Promise.all(
      LENSES.map((lens) =>
        judgeOnce(registry, config, meter, goal, output, lens.angle)
          .then((v) => ({ lens: lens.key, ...v }))
          .catch((err) => ({ lens: lens.key, met: false, feedback: `lens failed: ${(err as Error).message}` })),
      ),
    )
    const dissent = verdicts.filter((v) => !v.met)
    if (dissent.length === 0) {
      return { met: true, feedback: 'All three review lenses approved.' }
    }
    return {
      met: false,
      feedback: dissent.map((v) => `[${v.lens}] ${v.feedback}`).join('\n'),
    }
  }
}
