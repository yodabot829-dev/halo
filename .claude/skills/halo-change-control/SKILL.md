---
name: halo-change-control
description: >
  The change-control discipline for the HALO repo. Read this BEFORE making any
  change to HALO: what you may never touch (the running com.shumon.halo daemon,
  launchd, halo.config.yaml, .env/secrets, Telegram config, port 4720), the
  PR-only workflow, loop-branch naming, the single-PR queue rule, the
  "incident is not a refactoring opportunity" stop condition, the
  .claude/settings.json deny-list, when a change needs an owner-applied daemon
  restart, honest branch topology (what's merged vs unmerged), and scoreboard
  reporting. Triggers: restart daemon, launchctl, edit config, push, merge,
  open PR, deploy change, apply fix, loop run, kickstart, stop HALO.
---

# HALO Change Control

Repo: `/Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo`.
HALO is a live, always-on personal daemon (`com.shumon.halo`, Fastify on
`127.0.0.1:4720`) supervised by launchd with `KeepAlive=true`. It is running
right now while you work. Every rule in this skill exists to keep it running.

**Core model: agents propose, the owner applies.** You change code on a
branch and open a PR. You never restart anything, never merge anything,
never edit live config. This is stricter than any sibling repo.

## The never-touch list

| Never | Why | What you do instead |
|---|---|---|
| Restart/stop/signal the daemon or ANY launchd service | KeepAlive daemon is live; a bad restart takes down the whole agentic OS | Propose in the PR body: "requires owner restart" |
| Run `launchctl` (any subcommand) | Deny-listed; owner-only | Document the exact command for the owner (below) |
| Edit `halo.config.yaml` in place | It's the live daemon's config | Propose the diff as a commit in your PR — owner reviews and applies |
| Touch `.env`, secrets, or Infisical | Secrets are chmod-600, gitignored; `infisical` is deny-listed | Name the needed env var in the PR; owner sets it |
| Touch Telegram channel config | Load-bearing chief-of-staff channel (lives in OpenClaw today, not HALO) | Hands off entirely |
| Bind or probe-with-side-effects port 4720 | The live daemon owns it | Tests use ephemeral ports (existing test suite already does) |
| `git push` to `main`, `gh pr merge` | Human merges; both deny-listed | Open a PR and stop |
| `rm -rf`, `sudo`, `crontab` | Deny-listed | Don't |

The restart command — **for the OWNER only, never for you to run**:

```
launchctl kickstart -k gui/501/com.shumon.halo
```

Put that line in your PR body when a change needs it. That is the whole of
your involvement with launchd.

### Enforcement: `.claude/settings.json`

The repo deny-list (verified as of 2026-07) blocks: `launchctl *`,
`infisical *`, `crontab *`, `sudo *`, `rm -rf*`, `gh repo delete*`,
every push-to-main/force-push variant (plain and `command git` forms), and
`gh pr merge` / `command gh pr merge`. Allowed: edits, `git`/`command git`,
non-merge `gh pr` subcommands, `npm test`/`npm run`, `npx`. If a command is
denied, that is the discipline working — do not route around it.

## The PR workflow

1. **Health check first.** If the daemon looks unhealthy (errors in
   `~/.halo/logs/halo.err.log`, `/api` unresponsive), **stop and report**.
   *"An incident is not a refactoring opportunity."* Do not ship changes
   into a degraded system; diagnosis and report is the entire deliverable.
2. **Queue check.** If **≥1 unreviewed loop PR is already open**, do not
   open another — queue instead. This single-file queue is stricter than
   other repos' loops. Check: `command gh pr list --state open`.
3. **Branch.** Loop-agent work uses `loop/YYYY-MM-DD-<slug>` (e.g.
   `loop/2026-07-10-goal-engine-hardening`, which became merged PR #2).
   Interactive/feature work uses conventional `feat/`, `fix/` branches.
4. **One item, one PR.** No bundling.
5. **Tests green before the PR.** `npm test` (core vitest, ~146 tests on
   main as of 2026-07). Note: there is NO web/UI test coverage — say so in
   the PR if you touched `web/`, don't claim tested.
6. **Open the PR, never merge.** Use `command gh` (the `rtk` wrapper can
   silently mangle `gh`/`git push` output — trust exit codes, prefix with
   `command`).
7. **PR body must state the deployment story** (next section) and any
   config/env changes as proposals.

Charter priorities when choosing what to work on (from LOOP.md): PR hygiene
→ goal-engine hardening → slice 7 → coverage → docs.

## What takes effect when (deployment story)

| You changed | Takes effect | Owner action needed |
|---|---|---|
| `core/src/**` (backend) | Only after daemon restart | Yes — `launchctl kickstart -k gui/501/com.shumon.halo` after merge |
| `web/` built output (`dist`) | On browser refresh | None |
| `web/` source in dev (`npm run dev -w web`, :5173) | Vite hot-reload | None |
| `halo.config.yaml` (proposed diff) | After owner applies + restarts | Yes — apply diff, then restart |
| `.env` / secrets | Owner-only territory | Owner edits, then restarts |
| Tests, docs, LOOP.md | On merge | None |

Always say which row your PR falls in. A merged backend PR that nobody
restarted is silently not running — that is expected, not a bug.

## Branch topology honesty (as of 2026-07)

This table is the **owning home** of branch/PR/worktree status — other HALO
skills point here; when topology changes (PR #3 merges, terminal lands,
halo-g2 removed), fix it here first. Docs lie; git does not: the repo's two
docs of record are stale — see **halo-architecture-contract** §Stale docs.

| Ref | Status (as of 2026-07-12) |
|---|---|
| `main` | Contains PR #1 (Watchtower loop monitor) and PR #2 (goal-engine hardening). Both MERGED. |
| PR #3 `fix/goal-engine-immutability` (34615c5) | **OPEN** — immutable `GoalEngine.emit/run`. Counts against the one-PR queue. |
| `feat/terminal-per-project` | **UNMERGED** — terminal-per-project + WS security fixes + voice toggles. Predates hardening; merging it needs a careful rebase + re-run of hardening tests + WS security re-verification. Owner-gated. |
| `origin/feat/goal-engine-hardening` | Substance already on main via PR #2 — do not re-land. |
| `halo-g2` sibling worktree | **ORPHANED** (broken .git link, stale 6 Jul snapshot). Do not use; cleanup debt. |

Verify, don't recite: `command git log --oneline -3 main` and
`command gh pr list --state all --limit 5`.

## Scoreboard reporting

Loop runs report to `LOOP-SCOREBOARD.md` in the vault
(`~/Documents/Openclaw yodabot/`). One line per run: date, item worked,
PR opened (number + branch) or the stop condition hit (no qualifying item /
daemon unhealthy / PR queue full). Report honestly — a run that correctly
stopped is a successful run.

## Pre-PR checklist

- [ ] Daemon healthy (or you stopped and reported instead)
- [ ] No unreviewed loop PR already open
- [ ] Branch named correctly (`loop/YYYY-MM-DD-*` for loop work)
- [ ] One item only
- [ ] `npm test` green; UI-untested noted if `web/` touched
- [ ] No edits to `halo.config.yaml` live file, `.env`, Telegram config
- [ ] PR body: deployment row + owner restart command if backend changed
- [ ] Pushed with `command git push -u origin <branch>`; PR via `command gh pr create`
- [ ] Did NOT merge; scoreboard line written (loop runs)

## When NOT to use this skill

- Understanding modules, ports, config schema, how it runs → **halo-build-run-and-operate** / **halo-architecture-contract**
- Goal-engine internals, judges, loop mechanics → **halo-goal-engine-and-loops**
- Diagnosing a failure or digging through history/sagas → **halo-debugging-and-archaeology**
- Memory/vault/voice/provider work → **halo-memory-voice-and-providers**
- The slice-7 + branch-convergence campaign itself → **halo-slice7-convergence-campaign**

## Provenance & maintenance

- Deny-list: `cat /Users/shumonchoudhury/.openclaw/workspace/yodaclaude/halo/.claude/settings.json`
- Loop rules: `cat .../halo/LOOP.md`
- Merged vs open: `cd .../halo && command gh pr list --state all --limit 10`
- main HEAD: `command git log --oneline -3 main` (top entries should be the PR #2 hardening and PR #1 Watchtower merges; anything newer means the topology table above needs re-verifying — exact SHA of record lives in **halo-architecture-contract**)
- Daemon plist (read-only): `cat ~/Library/LaunchAgents/com.shumon.halo.plist`
