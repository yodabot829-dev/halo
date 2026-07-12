---
name: halo-debugging-and-archaeology
description: >
  Debug the HALO daemon and know its failure history. Use when: HALO is down or
  unresponsive on :4720; ECONNREFUSED on :2022 (whisper) or :8880 (Kokoro); a
  terminal/PTY fails with posix_spawnp; a new API route 404s; goals are stuck in
  status running; chat is very slow (~40s); an executor goes silent or a goal
  times out; the whole machine stalls during generation; the daemon SIGABRTs on
  startup; or you need the history of a past bug ("was this fixed?", "which
  commit?", stranded goals, concurrency clobber, WS RCE, Watchtower origin,
  halo-g2 worktree). Symptom-to-fix triage table plus the full fix chronicle.
---

# HALO Debugging & Archaeology

HALO is a single-user agentic-OS daemon: Fastify 5 / TypeScript, repo
`/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`, running under
launchd as `com.shumon.halo` on 127.0.0.1:4720 (as of 2026-07).

**Prime directive: the running daemon is untouchable.** launchd `KeepAlive=true`
respawns it in ~10s if it dies. You NEVER run `launchctl`, never kill the
process, never bind :4720, never edit `halo.config.yaml` or `.env`. When a fix
requires a restart, say exactly that and hand the owner the command — the owner
runs it, not you:

```
launchctl kickstart -k gui/501/com.shumon.halo   # OWNER-ONLY, never run this yourself
```

## Triage table — symptom → action

Start with the logs, always readable without touching anything:

```
tail -100 ~/.halo/logs/halo.err.log
tail -100 ~/.halo/logs/halo.out.log
curl -s http://127.0.0.1:4720/api/health   # if a health route exists on the running build; otherwise any GET proves liveness
```

| Symptom | Diagnosis | Action |
|---|---|---|
| Daemon down / :4720 not answering | launchd KeepAlive respawns it in ~10s; if it stays down it is crash-looping (ThrottleInterval=10) | Read `~/.halo/logs/halo.err.log` for the crash. Propose the fix as a PR. **Never kickstart yourself** — owner restarts. |
| `ECONNREFUSED 127.0.0.1:2022` or `:8880` | whisper.cpp / Kokoro voice services get SIGKILL'd under memory pressure on the 16GB Mac and respawn; Kokoro also unloads when idle and spawns on demand | Not a failure. Wait a few seconds and retry. Only investigate if it persists for minutes. |
| PTY spawn fails: `posix_spawnp failed` | node-pty prebuilt `spawn-helper` loses its exec bit after a fresh `npm install` | `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` |
| New backend route 404s after you edited `core/src/server/` | The live daemon runs the code from before your edit; tsx under launchd does not hot-reload | Your code is probably fine — verify with `npm test`. Route goes live only after an owner restart. Say so; don't debug a ghost. |
| Goal files stuck `status: running` | Run-state was in-memory; a daemon crash strands them | Fixed: `core/src/goals/reconcile.ts` (`reconcileStrandedGoals`, called from `core/src/index.ts` at boot) marks orphans stopped with a boot-log entry. They self-heal on the next owner restart — do not hand-edit goal files. |
| Chat very slow (~40s/message) | Claude-Max-subscription bridge spawns a full `claude -p` Claude Code agent per message (`core/src/providers/claude-code-chat.ts`) | Expected. Use the Synthetic model in the chat model dropdown for the fast path. Also note the Max 5h session cap auto-falls-back to Synthetic. |
| Executor goes silent, goal step dies at ~10min | Working as designed: inactivity watchdog (`goals.inactivityTimeoutMinutes`, default 10) SIGTERMs, then SIGKILLs after 15s | Check the goal file's audit log in the vault `OS/Goals/` for the watchdog entry. If the work legitimately needs longer quiet periods, propose a config diff in a PR — never edit `halo.config.yaml` in place. |
| Generation stalls the whole machine / voice dies mid-chat | Ollama context or model pressure: `numCtx` is capped at 8192 (the default stalls the 16GB machine); `gemma3:12b` can evict the voice services from RAM | Prefer smaller local models or API models; expect voice ECONNREFUSED right after heavy local generation. |
| SIGABRT / native crash at startup | onnxruntime version conflict (Kokoro TTS uses onnxruntime-node) | The repo pins/overrides the onnxruntime version — check `package.json` overrides before touching anything, and keep the pin when bumping deps. |
| PTYs / terminal UI absent entirely | You are on `main` — the terminal feature lives ONLY on unmerged branch `feat/terminal-per-project` | Not a bug. See Archaeology #9. |

## Archaeology — the fix chronicle

Every entry: symptom → cause → fix → status. All commits verifiable with
`git log --oneline <sha>` in the repo. Sagas 1–5 and 7 merged via PR #2
(on main); statuses as of 2026-07.

1. **Stranded running goals** (`42dec27`, `9c05ff6`). Goals stuck
   `status: running` forever after a daemon crash. Cause: run-state held only
   in memory. Fix: boot reconciliation — `goals/reconcile.ts` sweeps orphaned
   running goals to stopped at startup. Proven by the crash-restart test (#5).
   **MERGED.**

2. **Runaway concurrency** (`f144bd6`, `74da990`). Multiple goals hammering the
   same project directory simultaneously. Cause: no cap, no mutex. Fix:
   `goals.maxConcurrent` (default 1) + a same-project mutex in the engine.
   **MERGED.**

3. **Silent executor stall** (`060fe19`, `e3a1338`). A silent child burned the
   whole 30-min step timeout; some hangs were SIGTERM-immune. Fix: inactivity
   watchdog (`goals.inactivityTimeoutMinutes`, default 10) and every kill path
   escalates SIGTERM → SIGKILL after 15s. **MERGED.**

4. **Cross-iteration amnesia** (`7e6fc6f`, `9fa746a`). Executor forgot its own
   progress each iteration. Cause: the engine's log-writes clobbered the
   executor's edits to the goal file. Fix: `## Plan` / `## Done so far`
   checkpoint sections; the engine re-reads the file from disk under lock
   before saving. **MERGED.**

5. **Crash-restart proof** (`b30958a`, `e2718f3`). Not a bug — an evidence
   test: boots a real daemon in a temp vault on an EPHEMERAL port, SIGKILLs
   it, reboots, asserts stranded goals were stopped and checkpoints survived.
   Never touches :4720. The template for any future daemon-lifecycle test.
   **MERGED.**

6. **emit/run in-place mutation** (`34615c5`). Inspector review flagged
   `GoalEngine.emit()` mutating the Goal object shared across the run loop.
   Fix: immutable emit/run — spread into a new Goal, thread it through;
   146/146 tests green. **PR #3 OPEN** (branch `fix/goal-engine-immutability`)
   — NOT on main yet; do not assume immutability when reading `main`'s
   `goals/engine.ts`.

7. **Cost blindness** (`a55988c`, `783a1c8`). Goal-executor token usage was
   invisible. Cause: `parseClaudeLine` didn't extract usage/cost/model. Fix:
   meter gains `cost_usd` + `costSince()`; goal runs metered under taskClass
   `goal-exec`. **MERGED.**

8. **Loop silence → Watchtower** (`1fbe035`, PR #1). No signal when the weekly
   improvement loops stalled. Fix: `core/src/loops/` read-only monitor —
   `status.ts` pure classifier (live/paused/stalled/errored/unknown),
   `sources.ts` best-effort gather (missing source → unknown, never crash),
   `alarm.ts` debounced osascript alarm persisted in dataDir; `GET /api/loops`.
   **MERGED** (timer wiring is a follow-up).

9. **WS drive-by RCE (CSWSH)** (`0d0aa60`). CRITICAL: the per-project terminal
   WebSocket had no Origin check — in loopback-no-token mode any web page could
   open `ws://127.0.0.1/ws/terminal/:name` and get a shell. Fix: Origin check
   on WS upgrade, in-band bearer auth before revealing project existence,
   `Object.hasOwn` allowlist, 1MiB maxPayload + zod caps, PTYs killed on
   shutdown. **Fixed on branch `feat/terminal-per-project` — the branch itself
   is UNMERGED.** Main has no terminal code; the branch predates the hardening
   merge, so it carries none of sagas 1–5. Merging it needs a rebase +
   hardening-test re-run + WS security re-verification.

10. **chokidar fd exhaustion / onnxruntime pin / kokoro streaming.** The memory
    fs-watcher (chokidar over a ~13k-note vault) and the voice stack each hit
    native limits early on; the surviving guards are the watcher config in
    `core/src/memory/`, the on-demand spawn/idle-unload behavior of Kokoro,
    and the onnxruntime version override in `package.json`. Exact originating
    commits (unverified) — treat the current pins as load-bearing and do not
    "clean them up".

## Fences — do NOT

- **Do not use the `halo-g2` sibling worktree.** Its `.git` link is broken
  ("fatal: not a git repository") and its content is a stale pre-hardening
  snapshot from 2026-07-03. Everything it staged already landed via PR #2 or
  is queued in open PR #3. It is cleanup debt, not a workspace.
- **Do not trust `docs/ARCHITECTURE.md` or `STATE.md` on daemon/hardening
  status.** Trust `git log` over prose — see **halo-architecture-contract**
  §Stale docs.
- **Do not re-stage or re-implement goal-engine hardening.** It exists in three
  branch forms (`feat/goal-engine-hardening`, `loop/2026-07-10-goal-engine-hardening`,
  and main) but the substance is already on main via PR #2. Only the terminal
  branch and PR #3 are genuinely unmerged (status of record:
  **halo-change-control** §Branch topology).
- **Do not rely on the codex executor fallback.** It is BLOCKED — see
  **halo-memory-voice-and-providers**. The working executor is `claude-code`
  (the default).
- **Do not restart, signal, or reconfigure anything under launchd**, and do not
  edit `halo.config.yaml`, `.env`, or the plist. Propose diffs in a PR; the
  owner applies. "An incident is not a refactoring opportunity."

## When NOT to use this skill

- Understanding module layout, routing, or data flow → **halo-architecture-contract**
- Building, running tests, env/config, ports, launchd facts → **halo-build-run-and-operate**
- How goals/judges/loops are *supposed* to work (not why they broke) → **halo-goal-engine-and-loops**
- Memory index, voice stack, or provider/model routing design → **halo-memory-voice-and-providers**
- PR discipline, branch rules, what you may change → **halo-change-control**
- Landing the terminal branch / slice 7 (Infisical, Tailscale, Telegram) → **halo-slice7-convergence-campaign**

## Provenance & maintenance

Re-verify the volatile claims (run in the repo, read-only):

- Main contains hardening + Watchtower: `git log --oneline main | head -3` → should show the PR #2 hardening merge above the PR #1 Watchtower merge (newer commits on top are fine — they just mean re-verify PR/branch status)
- PR #3 still open: `command gh pr view 3 --json state` (branch `fix/goal-engine-immutability`, `34615c5`)
- Terminal branch still unmerged: `git branch -a --contains 0d0aa60` → only `feat/terminal-per-project` lineage, not main
- halo-g2 still orphaned: `git -C ../halo-g2 status` → "fatal: not a git repository"
- Daemon alive: `tail -5 ~/.halo/logs/halo.out.log` (never launchctl)
- Hardening knobs still present: `grep -rn "inactivityTimeoutMinutes\|reconcileStrandedGoals" core/src`
