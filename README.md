# HALO

Personal agentic OS. One always-on daemon that unifies every project, model
subscription, and memory store behind a single clean interface. Persona: Cortana.

- **Multi-LLM, no lock-in** — Anthropic, OpenAI, Synthetic, OpenRouter, Google, local
  Ollama behind one `provider/model-id` abstraction (Vercel AI SDK).
- **Credit-aware routing** — tasks are classified (chat / summarise / code / reason /
  vision) and routed by tier order + declared budgets. Every call is metered in SQLite.
- **Vault memory** — markdown canon in the Obsidian vault (`OS/Memory/`), search index
  on top. Plain-text retrieval any model can consume.
- **Executors** — headless Claude Code (default) or Codex CLI dispatch for real work;
  goal files with success criteria, iterate until done.
- **Voice** — local Whisper in, local TTS out. £0.
- **Secrets** — Infisical only. Nothing sensitive in this repo, ever.

## Layout

```
core/   TypeScript daemon (Fastify) — providers, router, meter, memory, executors
web/    React frontend (Vite) — chat, projects, memory, ops views
docs/   specs and architecture notes
halo.config.yaml   non-secret configuration
```

## Develop

```bash
npm install
npm test               # core unit tests
npm run dev            # daemon on :4720 (tsx watch)
npm run dev -w web     # vite dev server on :5173, proxies /api
npm run build          # web dist + core dist
```

Run with secrets: `infisical run -- npm run dev` (keys land as env vars, e.g.
`ANTHROPIC_API_KEY`, `SYNTHETIC_API_KEY`; see `halo.config.yaml` for the full list).

Spec: `docs/specs/2026-07-02-halo-design.md`.
