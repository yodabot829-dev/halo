# HALO — State

Updated: 2026-07-02

## Done

- Design spec approved + committed (`docs/specs/2026-07-02-halo-design.md`)
- Slice 1 built and verified end-to-end:
  - Core daemon: config (zod+YAML), provider registry (Anthropic/OpenAI/Synthetic/OpenRouter/Google/Ollama via AI SDK v6), heuristic task classifier, tier-order model selection, SQLite token meter, Fastify server with SSE `/api/chat`, bearer-token auth hook, static web serving
  - Web: React chat UI, Helvetica design, routing-transparency chips, model override, SSE streaming
  - 23 unit tests green; live smoke test passed — auto-routed to local gemma3:12b, streamed reply, usage metered
  - Fix: Ollama `num_ctx` capped via config (131k default stalls this 16GB machine)

## Next

- Slice 2: memory — `OS/Memory/` schema in Obsidian vault, SQLite FTS5 + Ollama embeddings index, importers (claude-mem DB, ~/.claude memory dirs), retrieval into chat
- Slice 3: declared budgets + burn-down routing
- Slice 4: executor (headless Claude Code / Codex) + goal engine
- Slice 5: voice (local Whisper STT + local TTS)
- Slice 6: project visualisations
- Slice 7: OpenClaw absorption, Infisical migration of plaintext tokens in openclaw.json, launchd + Tailscale bind

## Blockers

- None. API keys not yet in env (expected — will come via `infisical run`); only Ollama available until then.

## Run

```bash
cd ~/.openclaw/workspace/yodaclaude/halo
npm install
npm run build          # web + core
./node_modules/.bin/tsx core/src/index.ts   # or: npm run dev
# open http://127.0.0.1:4720
```

## Files Changed

Everything (new repo).
