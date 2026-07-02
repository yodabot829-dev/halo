import { generateText } from 'ai'
import type { HaloConfig } from '../config/schema.js'
import type { Meter } from '../meter/meter.js'
import { providerCallOptions } from '../providers/options.js'
import type { ModelSource } from '../providers/registry.js'
import { budgetStatus, exhaustedProviders } from '../router/budget.js'
import { selectModel } from '../router/select.js'
import type { Judge } from './engine.js'

/** LLM verdict on whether a goal's success criteria are met. Model-agnostic:
 * routed like any 'reason' task, metered like any other call. */
export function makeLlmJudge(registry: ModelSource, config: HaloConfig, meter: Meter): Judge {
  return async (goal, executorOutput) => {
    const exhausted = exhaustedProviders(budgetStatus(config, meter, new Date()))
    const selection = selectModel('reason', registry.list(), config, undefined, exhausted)

    const prompt = [
      'You are a strict reviewer. Decide if the executor output shows ALL success criteria are met.',
      `## Objective\n${goal.objective}`,
      `## Success criteria\n${goal.criteria.map((c) => `- ${c}`).join('\n')}`,
      `## Executor report\n${executorOutput.slice(-6000)}`,
      'Reply with ONLY a JSON object: {"met": true|false, "feedback": "<what is missing or confirmation>"}',
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
          feedback: typeof parsed.feedback === 'string' ? parsed.feedback : result.text.slice(0, 500),
        }
      } catch {
        // fall through to conservative default
      }
    }
    return { met: false, feedback: `Reviewer reply was not parseable JSON: ${result.text.slice(0, 300)}` }
  }
}
