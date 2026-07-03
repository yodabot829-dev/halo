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
- **✅ Terminal per project (BUILT 2026-07-03, branch `feat/terminal-per-project`):**
  one `node-pty` per registered project over a WebSocket → `xterm.js` **Terminal**
  view + 🖥 button on each project page. **Launches an interactive `claude` session
  in the project dir** (`terminal.command` default `claude`; cwd = project = its
  context; set command:/bin/zsh args:[-l] for a shell, or args:[--continue] to
  resume). Sessions survive disconnects (ring-buffer replay). Origin-checked (closes
  a WS drive-by-RCE hole), in-band bearer auth, `Object.hasOwn` allowlist, PTYs killed
  on shutdown. 42 terminal/config tests green, typecheck + web build clean; verified
  live — a real `claude` TUI starts in the repo. Passed code + security review (5
  findings fixed, incl. 1 CRITICAL CSWSH).
  Spec: `docs/superpowers/specs/2026-07-03-terminal-per-project-design.md`.
  **Voice:** 🎙 push-to-talk dictation (whisper STT ~200ms) SENDS your speech to the
  Claude session (Enter appended). 🔊 auto-read exists (British "Jarvis" voice
  `bm_george`, per-call `/api/voice/tts` voice override) but **cannot cleanly read
  Claude's redrawing TUI** — it's really for shell-command output. For voice-in +
  clean voice-out about a project, the scoped **Chat** ("💬 Chat about this project")
  is the better surface (reads Claude's reply text, not a TUI). ⚠️ Chat currently
  speaks in Cortana `af_sky`, not Jarvis — a one-line change if wanted.
  **Not yet merged to main** — review branch (10 commits ahead).

## Next / open

- **Merge `feat/terminal-per-project`** (4 commits ahead of main) once Shumon signs off.
- **Slice 7 (needs Shumon):** launchd daemon; Tailscale bind + `HALO_TOKEN`;
  migrate `.env` keys + plaintext OpenClaw Telegram/gateway tokens into Infisical;
  port the Telegram channel; retire OpenClaw gateway.
- **Next backlog (ARCHITECTURE.md §10):** streaming Max-sub bridge (7), multi-model
  council chat (8), knowledge-graph memory (10). Terminal follow-ups: per-tab
  Claude-mode toggle, panes/splits.

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
# open http://127.0.0.1:4720   (Chat · Board · Projects · Terminal · Goals · Memory · Ops)
```
Key is auto-loaded from `.env`. To route chat off the Max sub, pick a model in the
composer dropdown, or set `executors.default`/`routing.classOrder` in `halo.config.yaml`.
`node-pty` (Terminal) is a native module: after a fresh `npm install`, its prebuilt
`spawn-helper` may land without the exec bit — `chmod +x
node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` if PTYs fail with
`posix_spawnp failed`.

## Files / structure

Whole repo. Entry `core/src/index.ts` wires everything into `AppContext` → `buildApp`.
Config: `halo.config.yaml` (non-secret). Secrets: `.env`. See ARCHITECTURE.md §3–4.
