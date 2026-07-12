---
name: halo-architecture-contract
description: >
  Ground-truth architecture contract for the HALO personal agentic OS (repo
  ~/.openclaw/workspace/yodaclaude/halo). Use when you need to know what HALO
  is, its stack (TS/Node>=20.19/ESM, Fastify 5, React 19 + Vite, npm workspaces),
  the core/src module map, invariants (vault is canon, SQLite disposable, port
  4720 sacred, zod config schema, executor confinement, provider registry,
  launchd PATH), or the known weak points. Also the corrective lens for the two
  STALE docs (docs/ARCHITECTURE.md, STATE.md). Triggers: "what is HALO",
  "HALO architecture", "where does X live in halo", "halo module map",
  "halo invariants", "is the daemon launchd-managed", "which halo docs are stale".
---

# HALO Architecture Contract

Everything here was verified against git main `d165e89` (2026-07-12). That SHA is stated **only here** — if `git -C ~/.openclaw/workspace/yodaclaude/halo log --oneline -1 main` shows a different HEAD, main has moved: re-verify the volatile claims (branch/PR status, stale docs, weak points) before trusting any HALO skill. One rule above all others: **the daemon `com.shumon.halo` on port 4720 is LIVE under launchd KeepAlive. Never restart it, signal it, run `launchctl`, edit `halo.config.yaml` or `.env`, or bind port 4720.** Propose changes; the owner applies them.

## What HALO is

A single-user personal "agentic OS": one always-on daemon that unifies LLM subscriptions, project executors, vault-backed memory, goals, and local voice behind one API and web UI. Persona: Cortana. Design principle: **"own your memory, rent the intelligence"** — the durable asset is the Obsidian vault; model providers are swappable rentals.

## Stack

| Layer | Choice |
|---|---|
| Language/runtime | TypeScript, Node >= 20.19, ESM throughout |
| Backend | Fastify 5, port 4720, bind 127.0.0.1 (loopback only) |
| Frontend | React 19 + Vite (dev server :5173, proxies `/api`) |
| Repo shape | npm workspaces monorepo: `core/` + `web/`, ~5,600 LOC |
| DB | better-sqlite3 (meter ledger + memory index) in `~/.halo/data` |
| Native deps | better-sqlite3, onnxruntime-node, node-pty |
| Tests | vitest in core (~146 tests on main as of 2026-07 — PR #3 CI confirms 146/146; don't hardcode, `npm test` is truth); **zero web/UI tests** |
| Supervision | launchd `~/Library/LaunchAgents/com.shumon.halo.plist`, KeepAlive=true |

## Module map — `core/src/`

| Module | One-liner |
|---|---|
| `index.ts` | Bootstrap: load .env + config → build AppContext, reconcile stranded goals on boot, listen |
| `config/` | `schema.ts` zod schema = **source of truth** for `halo.config.yaml`; `load.ts` parses/validates |
| `providers/` | Registry mapping provider/model-id → Vercel AI SDK model or bridge; `claude-code-chat.ts` spawns a `claude -p` streaming bridge on the Max subscription |
| `router/` | Task classify / budget / model select — three pure functions |
| `meter/meter.ts` | Append-only SQLite token+cost ledger |
| `memory/` | Vault-as-canon: SQLite FTS5 + Ollama `nomic-embed-text` embeddings, hybrid RRF search, fs watcher, prompt context builders |
| `executor/` | Swappable project workers (`claude-code` default, `codex` BLOCKED); child spawn with `shell:false` |
| `goals/` | Goal files (markdown in vault `OS/Goals/`): `engine.ts` dispatch→judge→iterate, `judge.ts` (single or 3-lens panel), `reconcile.ts`, `notify.ts` |
| `actions/` | Named prompts, loop log injection, draft→approve gate, croner cron routines |
| `voice/` | whisper.cpp STT client, Kokoro on-demand ONNX TTS, macOS `say` fallback |
| `loops/` | Watchtower read-only loop monitor: `status.ts` classifier, `sources.ts`, `alarm.ts` |
| `projects/info.ts` | Registered-project metadata |
| `server/` | Fastify app, timing-safe bearer auth, one route file per surface |
| `terminal/manager.ts` | node-pty per-project terminal — **branch-only**, `feat/terminal-per-project`, not on main |

`web/src/` mirrors this: one folder per view — chat, actions Board, goals, memory (d3-force constellation), projects, ops, terminal (branch-only).

## Invariants — do not violate

1. **Vault is canon; SQLite is disposable.** The Obsidian vault (`~/Documents/Openclaw yodabot`: `OS/Memory/`, `OS/Goals/`, `OS/Runs/`, `OS/Reports/`) is the durable record. Everything in `~/.halo/data` (meter DB, memory index) is rebuildable from the vault. Never treat the SQLite files as data of record; never risk vault data to protect an index.
2. **Port 4720 is sacred.** The live daemon owns it. All tests boot on ephemeral ports (the crash-restart test proves a full boot cycle without ever touching 4720). Never bind 4720 in any test, script, or dev run.
3. **Config source of truth is code.** `halo.config.yaml` (committed, non-secret) is validated by the zod schema in `core/src/config/schema.ts`. Any config change starts by reading the schema; a yaml key the schema doesn't know is dead weight. Secrets live in gitignored `.env` (chmod 600) — `HALO_TOKEN`, `SYNTHETIC_API_KEY`, etc. Infisical migration is slice 7, **not active** (as of 2026-07).
4. **Executors are confined.** Goal/action executors run only inside the ~15 project dirs registered under `projects:` in config. Never point an executor at an unregistered path.
5. **Providers go through the registry.** Two paths matter: the claude-code bridge (Max subscription) is the *slow* path — it spawns a full agentic Claude Code process per chat message (~40s, reads files in its cwd); Synthetic is the *fast* chat path. Don't "fix" chat slowness by bypassing the registry.
6. **launchd gives no PATH.** The plist hard-codes an explicit PATH (the claude bridge and PTYs need it). Any new spawned binary must be reachable from that hard-coded PATH — `works in my terminal` proves nothing about the daemon.
7. **Auth is one bearer token** (`HALO_TOKEN`, timing-safe compare in `server/`), mandatory the moment bind leaves loopback. There is no per-route scoping — see weak points.

## Weak points (open, as of 2026-07 — do not report as fixed)

| Weakness | Reality |
|---|---|
| No web-UI tests | React views entirely untested; core vitest only |
| Auth scoping | Single bearer token, no per-action/per-route scoping |
| Task classifier | Heuristic, occasionally mis-routes (learned classifier is backlog) |
| Memory retrieval | Top-K paste into prompt (injectTopK=6), not graph retrieval |
| Codex executor | BLOCKED — see **halo-memory-voice-and-providers** §Providers; default stays `claude-code` |
| Docs lag code | See below — the two docs of record are stale |
| Slice 7 | OPEN: Infisical migration, Tailscale bind + HALO_TOKEN enforcement, Telegram port. Terminal branch + PR #3 unmerged — status: **halo-change-control** §Branch topology |

## Stale docs — trust git, not prose

`docs/ARCHITECTURE.md` and `STATE.md` were last trued up ~2026-07-03 and **predate PRs #1 (Watchtower) and #2 (goal-engine hardening) and the launchd install**. Where they conflict with reality:

- They say HALO is *not* a launchd daemon → **false**: `com.shumon.halo` runs under launchd with KeepAlive since 2026-07-03.
- They say goal-engine hardening is *staged in the halo-g2 worktree* → **false**: hardening is MERGED to main via PR #2; halo-g2 is an orphaned, broken worktree — do not use it.

This section is the **owning home** of the stale-docs fact — other HALO skills point here. If the docs get refreshed (slice7 Phase 2), fix it here first.

Never repeat a claim from either file without checking `git log main` first. They remain useful for diagrams, slice history, and the backlog list.

## Quick orientation commands (read-only)

```bash
cd /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo
git log --oneline -5 main                 # should show PR #2 hardening + PR #1 Watchtower merges
git branch -a                             # terminal branch is unmerged
ls core/src                               # module map above
grep -n "port\|bind" halo.config.yaml     # 4720 / 127.0.0.1 (do not edit)
curl -s http://127.0.0.1:4720/api/health  # daemon liveness (GET only)
```

## When NOT to use this skill

- Building, testing, or operating the daemon (npm commands, launchd, logs, node-pty gotchas) → **halo-build-run-and-operate**
- Making/reviewing any change, PR discipline, LOOP.md rules → **halo-change-control**
- Goal engine internals, Watchtower, improvement loops → **halo-goal-engine-and-loops**
- Memory/vault indexing, voice services, provider details → **halo-memory-voice-and-providers**
- Debugging a live symptom or digging through fix history → **halo-debugging-and-archaeology**
- The terminal-branch merge + slice 7 campaign → **halo-slice7-convergence-campaign**

## Provenance & maintenance

Re-verify before trusting after 2026-07:

- Main HEAD + merged PRs: `git -C ~/.openclaw/workspace/yodaclaude/halo log --oneline -5 main`
- Terminal branch still unmerged: `git -C ~/.openclaw/workspace/yodaclaude/halo log --oneline main..feat/terminal-per-project | wc -l` (nonzero = unmerged)
- PR #3 open: `command gh pr list -R <halo remote> --state open`
- Config schema drift: `git -C ~/.openclaw/workspace/yodaclaude/halo log -1 -- core/src/config/schema.ts halo.config.yaml`
- Stale-docs claim still holds: `git -C ~/.openclaw/workspace/yodaclaude/halo log -1 -- docs/ARCHITECTURE.md STATE.md` (if newer than the PR #2 hardening merge, the docs were refreshed — re-read them and update this section)
