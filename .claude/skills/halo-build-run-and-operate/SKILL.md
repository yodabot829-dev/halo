---
name: halo-build-run-and-operate
description: Build, test, configure, and operate the HALO daemon — npm install/workspaces and native-module traps (better-sqlite3, onnxruntime-node, node-pty spawn-helper chmod), npm test/dev/build, halo.config.yaml block-by-block walkthrough, .env secret names, the two launchd jobs (com.shumon.halo daemon on :4720, com.shumon.loop.halo weekly loop), owner-only restart rules, manual foreground run, external voice/embedding services (Ollama, whisper, Kokoro), data/log locations, and the GET /api/loops health surface. Use for "how do I run HALO", "build fails", "config option", "where are the logs", "daemon down", "ECONNREFUSED", "port 4720".
---

# HALO: Build, Run, and Operate

HALO is a personal single-user agentic OS: one always-on TypeScript daemon (Fastify 5 backend, React 19 + Vite 8 web UI, npm-workspaces monorepo with `core/` and `web/`, Node >= 20.19, ESM). Repo: `/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`.

## THE PRIME RULE (read first)

The daemon `com.shumon.halo` is LIVE on port 4720 under launchd `KeepAlive` (as of 2026-07). You must NEVER:

- restart, signal, `kill`, or `launchctl` anything (`launchctl` is deny-listed in `.claude/settings.json` alongside `infisical`, `crontab`, `sudo`, `rm -rf`, push-to-main, and `gh pr merge`)
- edit `halo.config.yaml` or `.env` in place — propose diffs in a PR instead
- bind port 4720 (tests use ephemeral ports; so must you)

Restart is OWNER-ONLY: `launchctl kickstart -k gui/501/com.shumon.halo`. Agents propose; the owner executes. `KeepAlive` means a killed daemon respawns in ~10s — so a "quick kill to free the port" doesn't even work, it just races you.

## Build

```bash
cd /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo
npm install          # installs both workspaces (core, web)
```

Native modules that compile/download prebuilds during install: `better-sqlite3` (meter + memory index), `onnxruntime-node` (Kokoro TTS), `node-pty` (terminal feature). These need install scripts allowed.

**node-pty trap (darwin-arm64):** a fresh `npm install` can leave the prebuilt `spawn-helper` without its exec bit. Symptom: PTY spawn fails with a `posix_spawnp` error. Fix:

```bash
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

### Commands (root `package.json`)

| Command | What it does |
|---|---|
| `npm test` | vitest run in `core` (~146 tests on main as of 2026-07; coverage over `core/src/**`, excludes `index.ts`) |
| `npm run dev` | daemon under tsx watch (`core`) — DO NOT run while the launchd daemon holds :4720; see "Manual foreground run" |
| `npm run dev -w web` | Vite dev server on :5173, proxies `/api` to the daemon |
| `npm run build` | builds `web` then `core` |

There are NO web/UI tests (known gap, as of 2026-07). Tests never touch :4720 — the crash-restart hardening test boots a real daemon in a temp vault on an ephemeral port.

## Config: `halo.config.yaml` (committed, non-secret)

Source of truth for the shape is the zod schema in `core/src/config/schema.ts`; loading in `core/src/config/load.ts`. Knobs not present in the yaml take schema defaults. Blocks:

| Block | Purpose / key fields |
|---|---|
| `server` | port 4720, bind 127.0.0.1 (loopback only), CORS, rate-limit. Config comments plan a Tailscale bind at "slice 7" — NOT active |
| `dataDir` | `~/.halo/data` — SQLite meter + memory index. Disposable; rebuildable from the vault |
| `vault` | canon store: `~/Documents/Openclaw yodabot`, `memoryDir: OS/Memory`, read-only `indexDirs`. ~13k notes indexed |
| `memory` | embed model (Ollama `nomic-embed-text`), `injectTopK: 6`, `personaPath: ~/.cortana/cortana-persona.md` |
| `providers` / `models` | provider registry → Vercel AI SDK models or the `claude -p` bridge (`core/src/providers/claude-code-chat.ts`, Max subscription); model refs with tier/classes |
| `projects` | registry of 15 directories — executors are CONFINED to these paths |
| `executors` | default `claude-code`. `codex` executor is BLOCKED — see **halo-memory-voice-and-providers** |
| `goals` | `dir: OS/Goals`, `maxIterations: 3`, `stepTimeoutMinutes: 30`, `judge: single` (or `panel` = 3 lenses, ~3x cost). Schema defaults (not in yaml): `maxConcurrent: 1`, `inactivityTimeoutMinutes: 10`, `notify: true` (osascript on completion) |
| `actions` | named one-click prompts; `loop: true` injects past run logs; `schedule:` (croner cron) makes a routine — e.g. nightly `skill-audit` "dreaming" at 03:00; `approval: true` = draft→approve gate |
| `voice` | whisper STT, Kokoro TTS, macOS `say` fallback |
| `budgets`, `routing.classOrder` | token budget router (classify/budget/select in `core/src/router/`) |

## Secrets: `.env` (gitignored, chmod 600)

Names and purpose only — never print values:

| Var | Purpose |
|---|---|
| `SYNTHETIC_API_KEY` | Synthetic provider (present; a syn_ key once leaked in a transcript — rotation candidate, as of 2026-07) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | documented provider keys |
| `HALO_TOKEN` | bearer auth (timing-safe check in `core/src/server/`); mandatory the moment the bind leaves loopback |

Real-env override: `infisical run -- <cmd>` takes precedence over `.env`. Migration of secrets to Infisical is slice 7 — OPEN, not active.

## Operate

### The two launchd jobs

| Label | What | Details |
|---|---|---|
| `com.shumon.halo` | the daemon | `~/Library/LaunchAgents/com.shumon.halo.plist`; runs `tsx core/src/index.ts` with WorkingDirectory=repo, `RunAtLoad`, `KeepAlive=true`, ThrottleInterval 10. Plist hard-codes PATH (launchd provides none; the claude bridge and PTYs need it). Logs: `~/.halo/logs/halo.out.log` and `halo.err.log` |
| `com.shumon.loop.halo` | weekly improvement loop | Sunday 05:17, `/bin/zsh ~/.claude/loops/run-loop.sh halo`, governed by the repo's `LOOP.md` (PR-only, single open loop-PR queue). Separate agent, not part of the daemon |

Note: `docs/ARCHITECTURE.md` and `STATE.md` are stale on daemon/hardening status — trust git and the plists (details: **halo-architecture-contract** §Stale docs).

### Manual foreground run — ONLY if the daemon is bootout'd

If the owner has already run `launchctl bootout` (otherwise you get a port clash with the KeepAlive'd daemon):

```bash
npm run build && ./node_modules/.bin/tsx core/src/index.ts
```

Boot path (`core/src/index.ts`): load `.env` + config into AppContext, reconcile stranded goals (`core/src/goals/reconcile.ts` — orphaned `status: running` goal files → stopped with a boot log), then listen.

### External services the daemon calls

| Service | Port | Notes |
|---|---|---|
| Ollama | 11434 | embeddings (`nomic-embed-text`) + local chat models; numCtx capped at 8192 (default stalls the 16GB machine); a large model like gemma3:12b can evict the voice services |
| whisper.cpp | 2022 | STT |
| Kokoro TTS | 8880 | ONNX, spawns on demand, unloads after idle |

Voice services get SIGKILL'd under memory pressure on the 16GB Mac and respawn on their own. **ECONNREFUSED on 2022/8880 usually means mid-respawn, not failure — retry before diagnosing.**

### Health and diagnostics (all read-only)

```bash
curl -s http://127.0.0.1:4720/api/loops        # Watchtower: improvement-loop status (live|paused|stalled|errored|unknown)
tail -50 ~/.halo/logs/halo.err.log             # daemon errors
tail -50 ~/.halo/logs/halo.out.log             # daemon stdout
ls ~/.claude/loops/logs/                       # improvement-loop run logs
```

Routes may require the bearer token (`Authorization: Bearer $HALO_TOKEN`).

### Data / state / logs map

| What | Where | Disposable? |
|---|---|---|
| SQLite (meter + memory index) | `~/.halo/data` | yes — rebuilt from vault |
| Vault (canon: memory, goals, runs, reports) | `~/Documents/Openclaw yodabot` — `OS/Memory/`, `OS/Goals/`, `OS/Runs/<action>/`, `OS/Reports/` | NO — canonical |
| Daemon logs | `~/.halo/logs/halo.{out,err}.log` | yes |
| Loop logs / scoreboard | `~/.claude/loops/logs/` / `LOOP-SCOREBOARD.md` in the vault | yes / no |

## Known operational quirks (as of 2026-07)

- Chat via the Claude Max bridge is slow (~40s/message — it spawns a full Claude Code agent per message and is agentic: it reads files in its cwd). The Synthetic model dropdown is the fast path.
- Synthetic GLM streaming omits input tokens; HALO estimates (~4 chars/token) in the meter.
- The terminal feature (node-pty per project, WebSocket + xterm.js) lives ONLY on unmerged branch `feat/terminal-per-project` — it is NOT in the running main-built daemon.
- Branch/PR/worktree status (PR #3, terminal branch, orphaned `halo-g2`, stray `.tmp-scan.py`): see **halo-change-control** §Branch topology. Slice 7 (Infisical, Tailscale, Telegram port) is OPEN.

## When NOT to use this skill

- Module map, request flow, API surface, design contracts → **halo-architecture-contract**
- What you're allowed to change and how (PR discipline, LOOP.md rules, propose-vs-execute) → **halo-change-control**
- Goal-file format, engine internals, judge panel, Watchtower internals → **halo-goal-engine-and-loops**
- Memory/vault indexing, voice pipeline details, provider/model routing → **halo-memory-voice-and-providers**
- Debugging past failures, branch topology, fix sagas → **halo-debugging-and-archaeology**
- Merging the terminal branch / finishing slice 7 → **halo-slice7-convergence-campaign**

## Provenance & maintenance

Re-verify before trusting (all read-only):

- Scripts: `grep -E '"(test|dev|build)"' package.json`
- Config knobs/defaults: `grep -n 'maxConcurrent\|inactivityTimeout\|notify' core/src/config/schema.ts`
- launchd jobs: `ls ~/Library/LaunchAgents/ | grep -i halo` and `plutil -p ~/Library/LaunchAgents/com.shumon.halo.plist`
- Daemon alive: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4720/api/loops`
- main HEAD / open PRs: `command git -C /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo log --oneline -1 main` and `command gh pr list -R <repo>`
- Branch-only terminal code: `command git -C /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo log --oneline main..feat/terminal-per-project -- core/src/terminal/`
