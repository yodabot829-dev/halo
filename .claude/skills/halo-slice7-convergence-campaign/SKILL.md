---
name: halo-slice7-convergence-campaign
description: >
  Runbook for the two open HALO campaigns (as of 2026-07): CAMPAIGN 1 — branch
  convergence (close PR #3 immutability, rebase-and-land feat/terminal-per-project
  onto hardened main with WS-security re-verification, cleanup of the orphaned
  halo-g2 dir / stale refs / .tmp-scan.py / lagging docs); CAMPAIGN 2 — slice 7
  remainder (Infisical secret migration + Synthetic key rotation, Tailscale bind
  with mandatory HALO_TOKEN, Telegram port from OpenClaw + gateway retirement).
  Use when asked to "finish slice 7", "merge the terminal branch", "converge
  branches", "rotate the leaked key", "move secrets to Infisical", "bind to
  Tailscale", or "retire the OpenClaw gateway". Every daemon/config/launchd
  action is PROPOSE-ONLY — the owner executes.
---

# HALO Slice 7 & Branch Convergence Campaign

Repo: `/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`.
The HALO daemon (`com.shumon.halo`, port 4720, launchd `KeepAlive=true`) is LIVE.

## Iron rules (read first)

- **Never** run `launchctl`, restart/signal the daemon, edit `halo.config.yaml` or `.env`, or bind port 4720. Tests use ephemeral ports.
- **PR-only.** Agents open PRs; the owner merges (`gh pr merge` is deny-listed). Never push to `main`.
- Destructive ops (file/branch deletion) need explicit owner approval, every time.
- Use `command git` / `command gh` (the `rtk` wrapper can silently no-op `git push` and mangle output).
- **Docs lag code**: `docs/ARCHITECTURE.md` and `STATE.md` are stale on daemon/hardening status — trust `git log`, not prose (details: **halo-architecture-contract** §Stale docs). Fixing them is Phase 2.
- One item, one PR. Tests green before the PR goes up.

Jargon: **CSWSH** = cross-site WebSocket hijacking (a web page in your browser opens a WS to localhost and drives it — here that meant drive-by remote code execution via the terminal PTY). **PTY** = pseudo-terminal (node-pty child process). **Owner** = Shumon; "owner-gated" = agent prepares everything, owner runs the final command.

## State snapshot (verify, don't trust — as of 2026-07-12)

```bash
cd /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo
command git fetch origin
command git log --oneline -3 origin/main         # should show PR #2 hardening on top of PR #1 Watchtower (newer commits = table below is stale)
command gh pr list --state open                  # expect PR #3 (fix/goal-engine-immutability)
command git rev-list --left-right --count origin/main...origin/feat/terminal-per-project
                                                 # expect ~"2  16": main 2 ahead, terminal 16 ahead
```

| Item | Status | Notes |
|---|---|---|
| PR #1 Watchtower, PR #2 hardening | MERGED to main | status of record: **halo-change-control** §Branch topology |
| PR #3 immutable `GoalEngine.emit/run` (`fix/goal-engine-immutability`, `34615c5`) | OPEN | 146/146 green claimed — re-verify |
| `feat/terminal-per-project` | UNMERGED, 16 ahead, PREDATES hardening | carries the WS security fixes; the two lines never met |
| `origin/feat/goal-engine-hardening`, `origin/loop/2026-07-10-goal-engine-hardening` | stale refs | substance already on main |
| `../halo-g2` sibling dir | ORPHANED worktree (broken `.git` link, stale 6 Jul snapshot) | delete candidate — owner approval |
| `.tmp-scan.py` | untracked stray in repo root | delete candidate — owner approval |
| Slice 7: Infisical / Tailscale / Telegram | OPEN (launchd part done) | Campaign 2 |
| Codex executor | BLOCKED (CLI rejects all models on plan) | leave alone |

---

# CAMPAIGN 1 — Branch convergence

## Phase 0 — Land PR #3 (immutability refactor)

Small, independent, lands first so Phase 1 rebases onto its result.

```bash
cd /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo
command git switch fix/goal-engine-immutability && command git rebase origin/main
npm test            # vitest, core workspace — expect ALL green (~146 on main lineage as of 2026-07; trust "all green", not the count)
command gh pr view 3 --json mergeable,statusCheckRollup
```

Review focus: `core/src/goals/` — `emit`/`run` must return new `Goal` objects (spread), no in-place mutation of the caller's object. If rebase conflicts or tests fail → fix on the branch, push, note in PR. Then **ask the owner to merge PR #3**. Do not proceed to Phase 1 until it's on main (or owner explicitly says skip).

## Phase 1 — Rebase and land `feat/terminal-per-project`

The big one. Terminal branch = node-pty per registered project (`core/src/terminal/manager.ts`, `core/src/server/routes/terminal.ts`, `web/src/terminal/`) over WebSocket → xterm.js, plus voice toggle. It has never seen the hardening commits; main has never seen the terminal code.

### 1a. Rebase

```bash
command git fetch origin
command git switch -c converge/terminal-on-main origin/feat/terminal-per-project
command git rebase origin/main
```

Expected conflict zones (both lines touched these): `core/src/server/app.ts` (route registration + shutdown hooks — hardening added goal reconcile at boot, terminal added PTY-kill on shutdown; **keep both**), possibly `core/src/index.ts` and `package.json`/lockfile. `core/src/goals/` conflicts should be rare (terminal branch barely touches goals) — if goals conflicts appear, resolve in favor of main's hardened versions.

### 1b. Full test suite

```bash
npm install         # node-pty native module
# node-pty trap: fresh install may drop the exec bit
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null
npm test            # expect main's ~146 PLUS ~40 terminal tests (~185+ total), ALL green
                    # a total near 146 means the rebase DROPPED the terminal tests — stop and re-resolve
```

Failures → fix on the rebase branch; if a hardening test breaks (boot-reconcile, notify, spawn watchdog), the rebase dropped hardening behavior — stop and re-resolve, don't patch the test.

### 1c. WS security re-verification (MANDATORY — closed a CRITICAL CSWSH drive-by-RCE)

All four properties must survive the rebase. Verify by reading the rebased code, not the branch's history:

| Property | Where | Check |
|---|---|---|
| WS Origin check | `core/src/server/routes/terminal.ts` | connection rejected when Origin is absent/foreign |
| In-band bearer auth | same | first-message/handshake bearer validated against `HALO_TOKEN` path (timing-safe compare lives in `core/src/server/`) |
| Project allowlist | `terminal.ts` / `manager.ts` | `Object.hasOwn` lookup against registered projects only — no arbitrary cwd |
| PTY kill on shutdown | `manager.ts` + `app.ts` shutdown hook | all PTYs killed (SIGTERM→SIGKILL pattern) |

Also confirm `maxPayload` cap and zod input validation on WS messages are intact, and that `core/test/terminal-manager.test.ts` + `core/test/terminal-route.test.ts` still cover these (grep the tests for `origin`, `bearer`, `kill`). If any property is missing post-rebase, that is a release blocker — restore it before opening the PR.

### 1d. PR

```bash
command git push -u origin converge/terminal-on-main
command gh pr create --title "feat(terminal): land terminal-per-project on hardened main" \
  --body "Rebase of feat/terminal-per-project onto main (post PR #2/#3). Full suite green (core+terminal). WS security posture re-verified: Origin check, bearer auth, project allowlist, PTY shutdown kill."
```

Owner merges. Owner also decides whether to restart the daemon to pick up the merge (`launchctl kickstart -k gui/501/com.shumon.halo` — **owner runs this, never you**).

Branch-on-failure: rebase unmanageable (>~1 day of conflict surgery) → fall back to `git merge origin/main` into a copy of the branch, same test + security gates, note the merge commit in the PR. Never force-push over `origin/feat/terminal-per-project` itself until the PR merges.

## Phase 2 — Cleanup (owner-gated deletions)

Only after Phase 1 merges.

1. **halo-g2**: confirm it's still orphaned (`git -C ../halo-g2 status` → "fatal: not a git repository") and diff-check nothing unique remains, then PROPOSE: `git worktree prune && rm -rf ../halo-g2`. Owner executes — file deletion.
2. **Stale branch refs** (propose, owner or agent-with-approval runs): delete `feat/goal-engine-hardening`, `loop/2026-07-10-goal-engine-hardening`, `fix/goal-engine-immutability`, `feat/terminal-per-project` (local + `command git push origin --delete <ref>`), after verifying each is fully contained in main (`git branch --merged main`, `git branch -r --merged origin/main`).
3. **`.tmp-scan.py`**: untracked stray in repo root — propose deletion.
4. **Docs refresh PR**: update `STATE.md` and `docs/ARCHITECTURE.md` to post-merge reality — launchd-supervised daemon, PRs #1/#2/#3 + terminal merged, halo-g2 gone, slice 7 remainder = Infisical/Tailscale/Telegram only. One PR, docs only.

---

# CAMPAIGN 2 — Slice 7 remainder (ALL owner-gated)

Precondition: Campaign 1 done, or owner explicitly decouples. Each sub-phase = its own PR + owner runbook; the agent never touches `.env`, `halo.config.yaml`, Infisical, or the daemon.

## 2a. Infisical migration + Synthetic key rotation

Goal: secrets move from gitignored `.env` (chmod 600) to Infisical, launchd runs the daemon under `infisical run --`. The Synthetic (`syn_`) key once leaked in a chat transcript — it MUST be rotated during migration.

Order (one secret at a time, verify between each):
1. Agent PR: docs + any code needed so config reads secrets purely from env (they already do — `SYNTHETIC_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `HALO_TOKEN`); plus a proposed plist diff wrapping the launch command in `infisical run --` (as a diff in the PR body — never edit `~/Library/LaunchAgents/com.shumon.halo.plist`).
2. Owner: create Infisical project/env, add ONE key, remove it from `.env`, restart daemon (`launchctl kickstart -k ...`).
3. Verify pickup (agent may run — read-only): `curl -s http://127.0.0.1:4720/api/...` health/chat path exercising that provider; also `tail ~/.halo/logs/halo.err.log` for missing-key errors.
4. Repeat per key. For Synthetic: owner generates a NEW key at the provider, puts the new one in Infisical, revokes the old — never migrate the leaked value.

Failure branch: daemon crash-loops after a key move (KeepAlive respawns every ~10s, `halo.err.log` fills) → owner restores the key to `.env`, restart, investigate before retrying.

## 2b. Tailscale bind + mandatory HALO_TOKEN

Goal: `server.bind` moves from `127.0.0.1` to the Mac's Tailscale IP; bearer auth becomes non-optional. `halo.config.yaml` already carries the comment "switch to Tailscale IP at daemon install (slice 7)".

1. Agent PR: (i) code change so the server **refuses to start** when bind ≠ loopback and `HALO_TOKEN` is unset (fail-fast in `core/src/index.ts`/`core/src/config/`), with a test; (ii) proposed `halo.config.yaml` diff (`server.bind: <tailscale-ip>`) in the PR body only.
2. Owner: set `HALO_TOKEN` (Infisical, per 2a), apply the config diff, restart.
3. **Measurable exposure gate** (owner or agent from another tailnet node, read-only):
   ```bash
   curl -si http://<tailscale-ip>:4720/api/loops            # expect 401
   curl -si -H "Authorization: Bearer $HALO_TOKEN" http://<tailscale-ip>:4720/api/loops  # expect 200
   ```
   Unauthenticated ≠ 401 → owner reverts bind to `127.0.0.1` immediately; do not leave it exposed while debugging. Also re-check the terminal WS: connection without bearer must be refused on the new bind.

## 2c. Telegram port + OpenClaw gateway retirement

Goal: HALO owns the Telegram chief-of-staff channel; the OpenClaw Gateway (port 18789) — whose only remaining load-bearing job is Telegram (verified 2026-04) — retires. `~/.openclaw/openclaw.json` holds a **plaintext bot token**; migration must remove it (and prefer rotating the bot token via BotFather, since it lived in plaintext).

1. Agent PR: Telegram channel module in HALO (webhook or long-poll into the existing chat/actions pipeline; token from env `TELEGRAM_BOT_TOKEN` via Infisical — never in config or code), allowlist of chat IDs, tests with a mocked Bot API.
2. Owner: add token to Infisical, restart daemon, verify a round-trip message HALO↔Telegram while OpenClaw is still up (parallel run — Telegram delivers to whichever polls; prefer HALO webhook to avoid double-consume, or short cutover window).
3. Cutover (owner): stop the OpenClaw gateway, remove the bot token from `openclaw.json`, confirm Telegram still round-trips through HALO for 24h.
4. Rollback: restart OpenClaw gateway, disable HALO's Telegram channel via config flag (build that flag into step 1).
5. Follow-up docs PR: mark slice 7 DONE in `STATE.md`; note gateway retired.

---

## When NOT to use this skill

- General architecture/module questions → `halo-architecture-contract`.
- How to build, test, run, or operate the daemon day-to-day → `halo-build-run-and-operate`.
- The PR/branch/daemon-sacredness rules in the abstract → `halo-change-control`.
- Goal engine, Watchtower, improvement loops → `halo-goal-engine-and-loops`.
- Memory/vault, voice, provider registry → `halo-memory-voice-and-providers`.
- Diagnosing a bug or digging through fix history → `halo-debugging-and-archaeology`.

This skill is only for executing the two campaigns above.

## Provenance & maintenance

Re-verify before acting (all read-only):

- Main HEAD + merged PRs: `command git -C <repo> log --oneline -3 origin/main` (should show the PR #2 hardening + PR #1 Watchtower merges; commits above them mean PR #3/terminal landed — re-verify the snapshot table).
- Open PRs: `command gh pr list --state open` (PR #3 open as of 2026-07-12).
- Terminal divergence: `command git rev-list --left-right --count origin/main...origin/feat/terminal-per-project` (`2 16` as of 2026-07-12).
- halo-g2 orphaned: `git -C /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo-g2 status` → fatal.
- Strays: `ls <repo>/.tmp-scan.py`.
- Slice 7 still open: grep `STATE.md` for "slice 7" — but remember STATE.md lags; git is truth.
- Daemon alive (never touch): `launchctl print gui/501/com.shumon.halo | head` — owner-run only; agents use `curl -s http://127.0.0.1:4720/api/loops` read-only instead.
