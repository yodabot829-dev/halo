# HALO — State

Updated: 2026-07-02 (evening)

## Latest (video-feature round — 4 items, all shipped)

- **Approval layer + Work board** — actions with `approval: true` draft first and
  park as `awaiting_approval`; Board tab has Approve/Reject (reject feedback feeds
  next draft), running strip, routines with next-fire, activity feed. vault-cleanup
  example (merge/re-file only). Nate B Jones's "draft never sends itself".
- **Graphify integration** — per-project "Build/Update graph" + blast-radius/
  architecture Q&A on project pages (`/api/projects/:name/graph|ask`, runAdhoc).
- **Project-scoped chat** — `@project` picker injects that project's STATE + memory.
- **Small wins** — token cost chip on chat replies; `goals.judge: panel` (3-lens
  unanimous); skill-audit "dreaming" cron at 03:00 nightly.
- **Executor note:** default reverted to claude-code. Codex fallback is BLOCKED —
  codex CLI rejects every model on the current ChatGPT plan ("not supported with a
  ChatGPT account"); needs plan change or re-login before it can cover Claude's 5h limit.

## Earlier today

- **Slice 8 (Chase AI video-inspired)** — Actions command center: one-click
  buttons dispatch headless executor runs, optional cron routines, run logs in
  vault `OS/Runs/` with past-run injection (self-improving loops). Default
  actions: skill-audit, vault-index, morning-brief. Memory constellation
  canvas graphic. skill-audit live-verified: mined claude-mem, wrote 12
  proposals to `OS/Reports/skill-audit-2026-07-02.md`.
- **In-process TTS** — Kokoro ONNX worker (spawn on demand, unload after 10min
  idle, `say` fallback). voicemode kokoro service no longer needed by HALO.
- gemma3:4b now free-tier default (12b evicted voice services); cancelled
  streams meter estimated tokens.

## Done

- Spec approved + committed (`docs/specs/2026-07-02-halo-design.md`)
- **Slice 1** — daemon (Fastify), provider registry (Anthropic/OpenAI/Synthetic/OpenRouter/Google/Ollama via AI SDK v6), task classifier, tier routing, SQLite meter, SSE chat, Helvetica web UI. Security-hardened after code+security review (CORS allowlist, timing-safe auth, loopback guard, rate limit, bounds).
- **Slice 2** — vault-first memory: `OS/Memory/` canon in Obsidian vault; imported 61 file memories + 2,315 claude-mem session summaries; 12,742 notes indexed AND embedded (FTS5 + nomic-embed-text via Ollama, RRF hybrid); persona + top-K notes injected into chat as plain markdown.
- **Slice 3** — declared monthly budgets, burn-down routing (exhausted providers skipped, override wins), cancelled-vs-failed call metering, Ops burn-down view.
- **Slice 4** — executors (claude-code headless default, codex swappable) + goal engine (markdown goals in `OS/Goals`, dispatch → LLM judge → iterate). Live-verified: real goal ran Claude Code, judge approved. Fixed chokidar fd-exhaustion (12.7k fds → 60) with native fs.watch.
- **Slice 5** — fully local voice: push-to-talk → whisper.cpp (:2022), replies → Kokoro (:8880), £0. Live-verified both directions.
- **Slice 6** — Projects portfolio view (git activity sparklines, STATE.md next-steps), Memory explorer view, 5-tab UI. Screenshot-verified.
- 73 tests green; typecheck clean both packages.

## Next (Slice 7 — needs Shumon)

- Put provider API keys into Infisical; run daemon via `infisical run -- npm run dev`
  (env names: ANTHROPIC_API_KEY, OPENAI_API_KEY, SYNTHETIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY)
- Set HALO_TOKEN (Infisical) and bind to Tailscale IP in halo.config.yaml
- launchd daemon (com.halo.core) for always-on
- Migrate plaintext Telegram bot token + gateway token out of `~/.openclaw/openclaw.json` into Infisical
- Port Telegram channel from OpenClaw; then retire OpenClaw gateway
- Set real Synthetic monthly quota in `budgets:` (placeholder 60M)

## Blockers

- None. Until keys land in env, only Ollama models are routable (by design).

## Run

```bash
cd ~/.openclaw/workspace/yodaclaude/halo
npm run build && ./node_modules/.bin/tsx core/src/index.ts
# open http://127.0.0.1:4720  (Chat · Projects · Goals · Memory · Ops)
```

## Files Changed

Whole repo (new). Vault additions: `OS/Memory/**` (2,376 imported notes), `OS/Goals/*`.
