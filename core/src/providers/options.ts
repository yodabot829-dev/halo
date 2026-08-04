import type { HaloConfig } from '../config/schema.js'

/** Provider-specific call options. Ollama: cap the KV-cache context —
 * the daemon default (131k) stalls 16GB machines.
 *
 * Note: disabling Synthetic's unsigned thinking blocks (see registry.ts's
 * makeFactory) happens via a fetch-level body patch, not here — the AI SDK's
 * `thinking: {type: 'disabled'}` providerOption is a no-op on the wire (it
 * only ever emits the `thinking` field for 'enabled'/'adaptive'), so it can't
 * suppress thinking through this options path. */
export function providerCallOptions(
  config: HaloConfig,
  provider: string,
): { ollama: { options: { num_ctx: number } } } | undefined {
  const cfg = config.providers[provider]
  if (cfg?.kind === 'ollama' && cfg.numCtx) {
    return { ollama: { options: { num_ctx: cfg.numCtx } } }
  }
  return undefined
}
