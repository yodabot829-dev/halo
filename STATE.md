# HALO — State

Updated: 2026-07-03

**Full reference:** `docs/ARCHITECTURE.md` (every component, wiring, diagrams, API,
config, limitations, 26-item backlog). Read that first on any fresh session.

## What HALO is

Personal agentic OS: one Node/TS daemon (Fastify `:4720`) + React web app it serves.
Multi-LLM routing, vault memory, goals/actions with approval, voice, all local.
~5,600 LOC, 104 core tests, ~24 commits. Persona: Cortana. Binds localhost today.

## Done (this build, in order)

- **Slices 1–8** (see git log / ARCHITECTURE.md §6): daemon + provider registry,
  vault memory (13k+ notes, FTS5 + Ollama embeddings), budget router, executor +
  goal engine, local voice, project visualisations, Actions command center.
- **Video-feature round** (Chase AI + Nate B Jones + others): approval layer + Work
  **Board**, graphify integration, project-scoped chat, cost chip, panel judge,
  nightly "dreaming" skill-audit cron.
- **In-process TTS**: Kokoro ONNX worker, spawns on demand, unloads after idle,
  macOS `say` fallback. 0 MB idle.
- **Synthetic + GLM-5.2 wired** via gitignored `.env` (loader added; `infisical run`
  overrides). Note: Synthetic serves GLM-5.2 at **512K** (not 1M) and text-only.
- **Claude Code chat bridge**: chat PRIMARY = Claude Max sub via `claude -p`;
  Synthetic quota = automatic secondary/fallback. Both paths live-verified.
- **Full architecture doc** (`docs/ARCHITECTURE.md`, 567 lines, 6 Mermaid diagrams,
  fact-checked against code).
- **Wide-screen layout**: app fills large displays; chat stays a centered column.
- **Click a project → scoped chat window** ("Chat about this project" button;
  memory + STATE injected).

## Next / open

- **Slice 7 (needs Shumon):** launchd daemon; Tailscale bind + `HALO_TOKEN`;
  migrate `.env` keys + plaintext OpenClaw Telegram/gateway tokens into Infisical;
  port the Telegram channel; retire OpenClaw gateway.
- **★ Requested feature — terminal per project** (ARCHITECTURE.md backlog D-14):
  PTY (`node-pty`) per registered project over WebSocket + `xterm.js` in a Terminal
  tab. Bearer-gated, confined to project dirs, Tailscale-only. Decide: raw shell vs
  scoped interactive Claude Code session. NOT yet built — this is the top backlog item.

## Blockers / caveats

- **Codex executor fallback BLOCKED**: codex CLI rejects every model on the current
  ChatGPT plan ("not supported with a ChatGPT account"). Needs plan change / re-login.
  Executor default reverted to `claude-code`.
- **Claude Max 5h session limit**: hit during the build; chat auto-falls-back to
  Synthetic when it triggers. CLI chat is slow (~40s) — dropdown → Synthetic is the
  fast escape hatch.
- **Synthetic key `syn_...` passed through chat transcript** — consider rotating in
  the Synthetic dashboard. Key lives in `halo/.env` (chmod 600, gitignored).
- Voice services (whisper `:2022`, Kokoro `:8880`) get SIGKILL'd under memory pressure
  on the 16GB Mac and respawn; ECONNREFUSED usually means mid-restart.

## Run

```bash
cd ~/.openclaw/workspace/yodaclaude/halo
npm run build && ./node_modules/.bin/tsx core/src/index.ts   # or npm run dev
# open http://127.0.0.1:4720   (Chat · Board · Projects · Goals · Memory · Ops)
```
Key is auto-loaded from `.env`. To route chat off the Max sub, pick a model in the
composer dropdown, or set `executors.default`/`routing.classOrder` in `halo.config.yaml`.

## Files / structure

Whole repo. Entry `core/src/index.ts` wires everything into `AppContext` → `buildApp`.
Config: `halo.config.yaml` (non-secret). Secrets: `.env`. See ARCHITECTURE.md §3–4.
