# HALO — Agentic OS Design

**Date:** 2026-07-02 · **Status:** Approved by Shumon · **Persona:** Cortana

## Purpose

A single always-on agentic OS that unifies everything built to date across OpenClaw and
Claude Code: multi-LLM chat and task execution with credit-aware model routing, a
rock-solid markdown memory system any model can consume, a clean Helvetica web frontend
with project visualisations, and fully local voice in/out. Not dependent on any one LLM.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Relationship to OpenClaw | New OS; OpenClaw absorbed over time (Telegram ported, gateway retired) |
| Task executor | Headless Claude Code (`claude -p`) default; pluggable — Codex CLI (ChatGPT sub) same interface; swappable via config |
| Frontend | Local web app, reachable remotely via **Tailscale** (no public ports) |
| Voice | Fully local, £0 — existing Whisper STT + local TTS (voicemode services or Kokoro) |
| Memory store | Markdown canon in existing Obsidian vault at `OS/Memory/`, SQLite FTS + local-embedding index on top; importers for claude-mem DB + `~/.claude/**/memory/` |
| Credits/routing | Declared budgets per provider + OS meters its own usage; routes by task class + remaining budget |
| Secrets | Infisical only; daemon launched via `infisical run --`; migrate plaintext OpenClaw tokens |
| Name / location | HALO · `~/.openclaw/workspace/yodaclaude/halo/` · launchd daemon |

## Architecture

### Core daemon (TypeScript/Node, Fastify)

- **Provider layer** — Vercel AI SDK adapters: Anthropic, OpenAI, Synthetic
  (Anthropic-compatible `api.synthetic.new`), OpenRouter, Google, Ollama (local).
  One `ModelRef` abstraction (`provider/model-id`); all base URLs config-driven.
- **Router** — classifies each request (chat / summarise / code / reason / vision),
  consults routing policy + budget state, picks a model. Every response is tagged with
  model + reason; user can override per message.
- **Meter** — SQLite ledger of every call (provider, model, tokens in/out, task class,
  timestamp). Budgets declared in config (flat subs, monthly quotas, $ credits, free
  local); burn-down computed from ledger.
- **Executor layer** — `execute(task, projectDir) → event stream` interface.
  Workers: `claude-code` (default), `codex`. Goal engine: goal = markdown file with
  success criteria; dispatch → verify → iterate until pass or human needed.
- **Memory service** — vault-first. Canon: `OS/Memory/` in the Obsidian vault
  (`~/Documents/Openclaw yodabot/`), strict frontmatter schema (facts, sessions,
  projects, daily logs). Index: SQLite FTS5 + embeddings from Ollama (free).
  Watcher reindexes on change. Retrieval returns **plain markdown snippets** pasted
  into context — no tool-calling required, so even weak models can use it.
  Writes go back as markdown files; Obsidian never drifts from the OS.
- **Voice service** — browser push-to-talk → local Whisper → OS → local TTS → browser
  audio. No paid APIs. Wake-word deferred.
- **Secrets** — Infisical everywhere. Nothing sensitive in config files or git.

### Frontend (React + Vite, served by daemon)

Helvetica Neue, generous whitespace, dark/light. Views:

1. **Chat** — conversation, routing-transparency chips (which model, why), model
   override, push-to-talk.
2. **Projects** — visual portfolio of all registry projects: git activity, STATE.md
   status, launchd jobs.
3. **Memory** — search + graph explorer over the vault index.
4. **Ops** — credit burn-down per provider, running goals with live logs.

### Network & security

- Binds localhost + Tailscale interface only. Zero public ports.
- Bearer-token auth on all API routes (token in Infisical) as defence in depth.
- Executor runs are confined to registered project directories.

## Build order (vertical slices)

1. Daemon skeleton + Infisical + providers + basic chat UI
2. Memory schema + indexer + importers → context-aware chat
3. Router with budgets + metering
4. Executor + goal engine (Claude Code dispatch, live logs)
5. Voice in/out
6. Visualisations + design polish
7. OpenClaw absorption: Telegram ported, plaintext tokens → Infisical, gateway retired

TDD throughout; 80%+ coverage target on core logic (router, meter, memory, config).

## Out of scope (for now)

- Wake-word always-on listening (phase 2+)
- Multi-user / multi-tenant anything
- Cloud deployment — this is a personal OS on the Mac
- Replacing Claude Code interactive use — HALO dispatches it, doesn't reimplement it
