---
name: halo-memory-voice-and-providers
description: >
  Domain reference for HALO's three subsystems: vault-as-canon memory (SQLite
  FTS5 + Ollama embeddings, hybrid RRF search, fs watcher, injectTopK context
  injection, import-memory tool), provider registry & routing (classify/budget/
  select, claude-code-chat bridge, Synthetic GLM-5.2, blocked codex, SQLite
  meter with cost_usd), and voice (whisper.cpp STT, Kokoro ONNX TTS worker,
  say fallback, af_sky/bm_george voices). Use when working on memory indexing,
  search relevance, embeddings, chat context, model routing, token metering,
  provider bridges, TTS/STT, or debugging Ollama/Kokoro/whisper behaviour.
---

# HALO memory, voice, and providers

Repo: `/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`. The HALO
daemon (`com.shumon.halo`, port 4720) is LIVE under launchd `KeepAlive`.
**Never restart, signal, or reconfigure it; never edit `halo.config.yaml` or
`.env`; never bind port 4720.** Propose changes via PR; the owner applies.

CRITICAL: `docs/ARCHITECTURE.md` and `STATE.md` lag the code — trust git and
the source files named below, not those docs' claims (details:
**halo-architecture-contract** §Stale docs).

## 1. Memory — vault is canon, SQLite is disposable

The Obsidian vault `~/Documents/Openclaw yodabot` is the single source of
truth (~13k notes indexed, as of 2026-07). HALO writes only to `OS/Memory/`
(plus `OS/Goals/`, `OS/Runs/`, `OS/Reports/`); everything else is indexed
read-only via `vault.indexDirs` in `halo.config.yaml`. The SQLite index +
meter live in `~/.halo/data` and are **disposable — rebuildable from the
vault**. Deleting the DB loses nothing canonical; deleting vault notes loses
data (never do that without owner approval).

Code map (`core/src/memory/`):

| File | Role |
|---|---|
| `service.ts` | Orchestrates indexing; fs watcher (see below) |
| `store.ts` | SQLite FTS5 store + embedding rows |
| `embed.ts` | Ollama `nomic-embed-text` embeddings |
| `context.ts` | Builds injected chat context |
| `note.ts` | Markdown note parsing |
| `project-context.ts` / `project-stats.ts` | Per-project context/stats |
| `core/src/tools/import-memory.ts` | Idempotent bulk importer into `OS/Memory/` |

Facts:

- **Search is hybrid RRF**: FTS5 keyword results and embedding
  nearest-neighbour results are fused with reciprocal-rank fusion. If
  relevance is off, check both legs — an Ollama outage silently degrades to
  keyword-only.
- **Embeddings need Ollama** on `:11434` with model `nomic-embed-text`
  (`memory.embedModel`). Ollama chat models run with `numCtx: 8192` on this
  16GB machine — the 131k default KV cache stalls it (`halo.config.yaml`,
  applied via `core/src/providers/options.ts` → `num_ctx`). Do not raise it.
- **File watching is native `fs.watch(dir, { recursive: true })`** in
  `service.ts` — not chokidar. Chokidar was removed after it exhausted file
  descriptors (~12.7k fds, EBADF crashes) watching the large vault
  (incident history; not reconstructable from the repo alone). Do not
  reintroduce chokidar.
- **Context injection**: chat pulls `memory.injectTopK` (= 6) top search hits
  into the prompt (`core/src/server/routes/chat.ts`), snippets capped at
  `snippetChars: 1500`. Persona prepended from
  `~/.cortana/cortana-persona.md` (`memory.personaPath`).
- **import-memory is idempotent** — safe to re-run; it will not duplicate
  notes.
- Known ceiling (backlog): retrieval is top-K paste, not graph retrieval.

## 2. Providers, routing, metering

Code map: `core/src/providers/` (`registry.ts`, `options.ts`,
`claude-code-chat.ts`), `core/src/router/` (`classify.ts`, `budget.ts`,
`select.ts`), `core/src/meter/meter.ts`.

- **Registry** maps `provider/model-id` refs (declared in
  `halo.config.yaml` `models:` with tier + task classes) to a Vercel AI SDK
  model or a bridge. Add models in config, not code, where possible.
- **Router = three pure functions**: `classify` (heuristic task class —
  known to mis-route occasionally), `budget` (spend gate against
  `budgets:`), `select` (pick model by class order + tier). Pure = easy to
  unit-test; keep them side-effect free.
- **claude-code-chat bridge** (`claude-code-chat.ts`): spawns `claude -p`
  (Claude Code CLI on the Max subscription) per message. It is **agentic**
  — it reads files in its cwd — so unscoped chats run in a neutral tmp dir;
  project-scoped chats run in the project dir. It is **slow (~40s)** and
  **text-only**. Claude Max 5h session limits make chat auto-fall-back to
  Synthetic. Do not "optimise" the latency away by caching responses; it is
  a full agent per turn by design.
- **Synthetic GLM-5.2**: served at **512K context (not 1M)**, text-only.
  Its streaming API omits input token counts, so HALO **estimates input
  tokens at ~4 chars/token** — meter numbers for this provider are
  approximate. A `syn_` API key once leaked in a chat transcript and is a
  rotation candidate (as of 2026-07).
- **codex executor/provider is BLOCKED** (as of 2026-07): the codex CLI
  rejects every model on the current plan. Default executor stays
  `claude-code`. Leave the codex wiring in place; do not delete or "fix" it
  without owner direction. (This bullet is the owning home of the codex
  status — other HALO skills point here; if codex unblocks, update this first.)
- **Meter** (`meter/meter.ts`): append-only SQLite token ledger with
  `cost_usd` per row and `costSince()`; goal-engine executor runs meter under
  task class `goal-exec`. Never rewrite rows — append only.
- Vision requires API models; local Ollama models here are text-first, and
  loading a large one (e.g. gemma3:12b) can evict the voice services under
  memory pressure.

## 3. Voice

Code map: `core/src/voice/` (`client.ts`, `kokoro-local.ts`,
`kokoro-worker.ts`, `protocol.ts`, `say-fallback.ts`, `wav.ts`),
`core/src/server/routes/voice.ts`.

- **STT**: whisper.cpp server on `:2022`, OpenAI-compatible transcription
  endpoint; browser audio is converted to 16kHz mono WAV first
  (`client.ts` `toWav16k`/`transcribe`).
- **TTS**: Kokoro-82M ONNX via an **on-demand child worker**
  (`kokoro-worker.ts`, JSON-lines protocol over stdin/stdout). It loads the
  model on first request and **unloads after idle**
  (`voice.idleUnloadMinutes` → `idleUnloadMs` in `kokoro-local.ts`). First
  synth after idle is slow — that is the cold load, not a bug.
- **kokoro-js gotcha**: streaming synth requires an explicit
  `TextSplitterStream` — construct it, `push` the text, and close it, then
  stream from `tts.stream(splitter, ...)`. Passing a raw string to the
  stream API hangs. See `kokoro-worker.ts`.
- **Fallback**: macOS `say` (`say-fallback.ts`) when the local engine fails.
- **Voices**: default `af_sky` ("Cortana", `voice.ttsVoice` in config).
  The terminal UI's read-aloud uses `bm_george` ("Jarvis") —
  `web/src/terminal/Terminal.tsx` `JARVIS_VOICE`. The per-call `voice`
  override on `POST /api/voice/tts` exists **only on branch
  `feat/terminal-per-project`** (compare `git show main:core/src/server/routes/voice.ts`
  — main has no request-level voice field). That branch is UNMERGED as of
  2026-07.
- **TTS-ing the terminal TUI is impossible** — the PTY stream is escape-code
  soup, not prose. Voice-both-ways = project-scoped **Chat**, not the
  terminal; the terminal's 🎙 toggle only reads assistant replies.
- **Ops reality on the 16GB Mac**: whisper (`:2022`) and Kokoro (`:8880`
  service variant) get SIGKILL'd under memory pressure and respawn —
  `ECONNREFUSED` usually means mid-respawn, not a broken install.
- **onnxruntime-node is pinned `^1.27.0`** via a root `package.json`
  dependency + allow-scripts entry: 1.21 SIGABRTs on Node 26. Do not let a
  dependency bump drag it back down.

## Quick checks (read-only, safe near the live daemon)

```bash
# memory index + meter DBs (disposable)
ls -lh ~/.halo/data
# Ollama up + embed model present
curl -s localhost:11434/api/tags | grep -o nomic-embed-text
# whisper STT up (ECONNREFUSED may just be a respawn)
curl -s -o /dev/null -w '%{http_code}\n' localhost:2022 || true
# config truths (READ ONLY — never edit)
grep -nE 'injectTopK|numCtx|ttsVoice|512K' /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo/halo.config.yaml
```

## When NOT to use this skill

- Module layout, config schema, run/build commands → `halo-build-run-and-operate` / `halo-architecture-contract`.
- Goal engine, executors, Watchtower, improvement loops → `halo-goal-engine-and-loops`.
- "May I change X on the live system?" / PR discipline → `halo-change-control`.
- Why is the daemon/branch in this state, past incidents → `halo-debugging-and-archaeology`.
- Merging the terminal branch, slice 7 (Infisical/Tailscale/Telegram) → `halo-slice7-convergence-campaign`.

## Provenance & maintenance

Verified against the live checkout on 2026-07-12 (main post-PR #2 hardening; terminal facts on `feat/terminal-per-project`). Re-verify with:

```bash
cd /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo
grep -n 'recursive: true' core/src/memory/service.ts            # native fs.watch
grep -n 'injectTopK' halo.config.yaml core/src/config/schema.ts # topK=6
grep -n 'numCtx' halo.config.yaml                               # 8192 cap
grep -n 'onnxruntime-node' package.json                         # ^1.27 pin
grep -n 'TextSplitterStream' core/src/voice/kokoro-worker.ts    # stream gotcha
grep -n 'JARVIS_VOICE' web/src/terminal/Terminal.tsx            # bm_george (branch)
command git show main:core/src/server/routes/voice.ts | grep -c 'voice'  # override branch-only
ls core/src/providers core/src/router core/src/meter core/src/tools
```
