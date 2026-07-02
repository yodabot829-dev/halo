import type { HaloConfig } from '../config/schema.js'

/** Provider-specific call options. Ollama: cap the KV-cache context —
 * the daemon default (131k) stalls 16GB machines. */
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
