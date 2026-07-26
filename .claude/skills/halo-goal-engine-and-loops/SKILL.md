---
name: halo-goal-engine-and-loops
description: "HALO goal engine, actions system, and Watchtower loop monitor. Use when working on goals (OS/Goals/ markdown files, GoalEngine.run, dispatch→judge→iterate, panel judge), goal-engine hardening (reconcileStrandedGoals, maxConcurrent, same-project mutex, inactivity watchdog, SIGTERM→SIGKILL, Plan/Done-so-far checkpoints, cost metering, osascript notify), the actions system (named prompts, loop run-log injection, croner schedules, approval gate), or the Watchtower read-only loop monitor (core/src/loops/, GET /api/loops, live/paused/stalled/errored/unknown). Also covers the known started:true API wart and open PR #3 (emit/run immutability)."
---

# HALO Goal Engine, Actions & Watchtower Loops

Repo: `/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`. Everything in this skill describes **main as of 2026-07**, which contains merged PR #1 (Watchtower) and PR #2 (goal-engine hardening). SHA of record + drift check: **halo-architecture-contract**.

**HARD RULE**: the daemon `com.shumon.halo` runs live on port 4720 under launchd `KeepAlive`. Never restart, signal, reconfigure, or bind 4720. Never run `launchctl`, never edit `halo.config.yaml` or `.env`. Propose changes via PR; the owner applies them. Tests use ephemeral ports.

**CRITICAL — docs lag code**: `docs/ARCHITECTURE.md` and `STATE.md` are stale on daemon/hardening status; trust git over prose (details: **halo-architecture-contract** §Stale docs). The `halo-g2` sibling worktree is orphaned; do not use it (**halo-change-control** §Branch topology).

## 1. Goals: the data model

A goal is a **markdown file in the vault** at `OS/Goals/` (vault = `~/Documents/Openclaw yodabot`). No database — the file is canon. Sections:

| Section | Meaning |
|---|---|
| Objective | What to achieve |
| Success criteria | What the judge checks |
| Status | `running` / `stopped` / done states — reconciled at boot |
| Executor | Which worker runs it (default `claude-code`; `codex` is BLOCKED — see **halo-memory-voice-and-providers**) |
| `## Plan` / `## Done so far` | Executor-maintained checkpoint (see hardening §3) |
| Audit log | Engine-appended event history |

Key files: `core/src/goals/goal-file.ts` (parse/serialize), `engine.ts`, `judge.ts`, `reconcile.ts`, `notify.ts`. Config: `goals:` block in `halo.config.yaml` — dir `OS/Goals`, `maxIterations: 3`, `stepTimeoutMinutes: 30`, `judge: single`, `maxConcurrent`, notify.

## 2. GoalEngine.run: dispatch → judge → iterate

`GoalEngine.run(id)` in `core/src/goals/engine.ts`:

1. **Guards**: reject if goal already running, if `this.running.size >= maxConcurrent`, or if another goal is running in the **same project** (same-project mutex). Rejections throw inside the async fn.
2. **Dispatch**: spawn the executor (`core/src/executor/`, `shell:false`) in the goal's registered project dir. Executors are confined to the ~15 dirs registered under `projects:` in config.
3. **Judge**: after each iteration, the judge evaluates output against success criteria. Two modes (`core/src/goals/judge.ts`):
   - `single` — one LLM verdict (config default).
   - **3-lens panel** — three judges: *literal* (criteria as written), *evidence* (demand proof), *skeptic* (assume failure, look for holes). Pass requires **unanimous** approval.
4. **Iterate**: on fail, feed the verdict feedback back and re-dispatch, up to `maxIterations` (3), then "max iterations reached — needs human review".
5. Events stream to the UI via SSE (`GET /api/goals/:id/events`).

## 3. Hardening (merged, PR #2) — what each feature is FOR

Each feature exists because a specific failure happened. Don't remove or "simplify" them without knowing the saga:

| Feature | Where | The saga it fixes |
|---|---|---|
| Boot reconciliation | `goals/reconcile.ts`, called from `core/src/index.ts` at startup | **Stranded running goals**: run-state was in-memory only; a daemon crash left goal files stuck `status: running` forever. Boot now flips orphaned `running` → `stopped` with a boot-log audit entry. Proven by a test that boots a real daemon in a temp vault on an ephemeral port, SIGKILLs it, reboots, and asserts the reconcile. |
| `maxConcurrent` + same-project mutex | `engine.ts` run guards | **Runaway concurrency**: multiple goals hammered the same project simultaneously. Default cap 1. |
| Inactivity watchdog + SIGTERM→SIGKILL | executor spawn path; `goals.inactivityTimeoutMinutes` (default 10) | **Silent executor stall**: a silent child burned the whole 30-min step timeout; some hangs ignored SIGTERM. All kill paths now escalate SIGTERM → SIGKILL after 15s. |
| Plan / Done-so-far checkpoints | `engine.ts` (prompt tells executor to maintain the two sections; engine re-reads the goal file before saving, under a lock in `emit`) | **Cross-iteration amnesia**: the engine's audit-log writes clobbered the executor's file edits, so each iteration forgot all progress. |
| Cost metering | `meter/meter.ts` (`cost_usd`, `costSince()`, taskClass `goal-exec`) | **Cost blindness**: goal-exec token usage was invisible; `parseClaudeLine` now extracts usage/cost/model. |
| Completion notify | `goals/notify.ts` — osascript macOS notification | Owner shouldn't have to poll the UI for goal completion. |

## 4. KNOWN WART: `POST /api/goals/:id/run` lies

In `core/src/server/routes/goals.ts`, the run route does:

```ts
const promise = engine.run(id)
promise.catch((err) => app.log.error(err, `goal ${id} run failed`))
return { success: true, data: { id, started: true } }
```

`engine.run` is `async`, so cap/mutex/already-running rejections become a **rejected promise** — which is only logged. The route's try/catch never fires and the client gets `started: true` even when nothing started. If a goal "won't start" with a 200 response, check `~/.halo/logs/halo.err.log` for "Goal concurrency limit reached" / mutex messages. A proper fix must await the guard phase (or check guards synchronously before dispatch) without blocking the response on the whole run — open design debt, not yet a PR (as of 2026-07).

## 5. PR #3 OPEN: emit/run immutability

Branch `fix/goal-engine-immutability` (34615c5). Inspector finding: `GoalEngine.emit()` mutates the `Goal` object passed to it, and `run` shares that mutable object across the loop. The fix makes emit/run return new Goal copies (spread). 146/146 tests green on the branch. **OPEN — not merged**; if you touch `engine.ts` on main, expect merge friction with this PR and check its status first (`command gh pr view 3 --repo <origin>` or `command git log --oneline main..fix/goal-engine-immutability`).

## 6. Actions system

`core/src/actions/` — named prompts runnable on demand, in loops, or on cron:

- **Named prompts**: defined under `actions:` in config; run logs land in the vault at `OS/Runs/<action>/`.
- **`loop: true`**: `run-log.ts` injects the last N run logs into the prompt so each run sees prior runs' output.
- **Schedules**: `scheduler.ts` uses `croner` (`new Cron(schedule, { protect: true }, ...)` — `protect` prevents overlapping runs). Live example: nightly skill-audit "dreaming" at 03:00.
- **`approval: true`**: the run produces a **draft**; nothing is applied until approved through the Work Board (`web/src/actions/Board.tsx`). Draft→approve gate lives in the actions runner + `server/routes/actions.ts`.

## 7. Watchtower (core/src/loops/) — READ-ONLY, keep it that way

Merged as PR #1. Monitors the **launchd improvement loops** (the weekly `com.shumon.loop.halo` etc.), because loops used to die silently (OpusWatch-style deadman problem). Three files:

- `status.ts` — **pure classifier**, dependency-injected reads. Inputs: scoreboard, `runner.log`, launchctl output, plist. States: `live | paused | stalled | errored | unknown`, precedence paused → errored → stalled → live → unknown.
- `sources.ts` — best-effort gathering. **A missing source yields `unknown`, never a crash.** Preserve this invariant in any change.
- `alarm.ts` — debounced osascript alarm, fires once per *newly*-stalled loop; the alarmed-set persists in `dataDir` so restarts don't re-alarm. (Timer wiring was left as a follow-up — verify before assuming the alarm fires unattended.)
- Surface: `GET /api/loops`.

**Contract: Watchtower never starts, stops, restarts, or reconfigures a loop.** It observes and alarms. Any PR that gives it write access to launchd or the loops violates its design and the daemon-sacredness rules — reject it.

## 8. Working on this area: checklist

1. Read `engine.ts`, `reconcile.ts`, and the hardening tests in `core/test/` (boot-reconcile, reconcile, notify, spawn, panel-judge) before changing behavior.
2. `npm test` (vitest, core workspace) must be green; hardening tests boot real daemons on ephemeral ports — never 4720.
3. PR-only workflow: branch `loop/YYYY-MM-DD-*` or `fix/*`, never push main, never merge (gh merge is deny-listed). Use `command git` / `command gh`.
4. Don't edit `halo.config.yaml` in place — propose diffs in the PR.
5. Check PR #3 status before touching `engine.ts`.
6. Goal/action file writes go to the vault (`OS/Goals/`, `OS/Runs/`) — SQLite in `~/.halo/data` is disposable; the vault is canon. Never delete vault files without owner approval.

## When NOT to use this skill

- Daemon lifecycle, launchd, ports, build/env/node-pty problems → **halo-build-run-and-operate**.
- Overall module map, config schema, provider/router/memory design → **halo-architecture-contract**.
- Branch topology, PR discipline, what may/may not be touched → **halo-change-control**.
- Memory/vault indexing, voice services, provider bridges → **halo-memory-voice-and-providers**.
- Digging through fix sagas, orphaned worktrees, stale docs → **halo-debugging-and-archaeology**.
- Merging feat/terminal-per-project, slice 7 (Infisical/Tailscale/Telegram) → **halo-slice7-convergence-campaign**.

## Provenance & maintenance

Verified against main (post-PR #2 hardening) on 2026-07-12. Re-verify:

- Engine guards + wart: `command git show main:core/src/server/routes/goals.ts | grep -n -A6 ':id/run'` and `command git show main:core/src/goals/engine.ts | grep -n maxConcurrent`
- Hardening present: `command git show main:core/src/goals/reconcile.ts >/dev/null && echo ok`
- Watchtower states: `command git show main:core/src/loops/status.ts | grep LoopState`
- PR #3 status: `command gh pr list --repo $(command git -C /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo remote get-url origin) --state open`
- Croner scheduler: `command git show main:core/src/actions/scheduler.ts | head -30`
