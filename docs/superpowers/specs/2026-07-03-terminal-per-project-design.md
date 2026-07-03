# Terminal per project — design

Date: 2026-07-03 · Status: approved-by-checkpoint (ARCHITECTURE.md backlog item 14, ★)
Branch: `feat/terminal-per-project`

## What

An interactive shell inside HALO, one per registered project: a PTY (`node-pty`)
rooted in the project directory, streamed over a WebSocket to an `xterm.js`
terminal in a new **Terminal** view. Lets Shumon run tests, git, or a live
interactive `claude` session in any repo — later from a phone over Tailscale.

## Decisions (previously open)

- **Raw shell vs scoped Claude Code session → raw shell**, spawned from config
  (`terminal.shell`, default `$SHELL` → `/bin/zsh`). A scoped-Claude terminal is
  not a smaller attack surface — Claude Code executes arbitrary shell commands
  anyway — so the choice is UX, not security. Raw shell is strictly more general
  (`claude` is one keystroke away inside it). A per-tab "Claude mode" later is
  just a different spawn command; the manager takes the command from config, so
  the fork never becomes architectural.
- **Placement → top-level Terminal view** with a project picker, plus an
  "Open terminal" button on each project detail page that jumps there
  pre-scoped (same pattern as "Chat about this project"). Panes/splits deferred.

## Architecture

```
xterm.js (web)  ⇄  WS /ws/terminal/:name  ⇄  TerminalManager  ⇄  node-pty (zsh, cwd=project)
```

### TerminalManager (`core/src/terminal/manager.ts`)

Sessions keyed by registered project name; at most one PTY per project.

- `attach(name)` — return existing session or spawn `terminal.shell` with
  `cwd = config.projects[name]`; emits data events; keeps a ring buffer
  (`terminal.scrollbackBytes`, default 200 KB) replayed on every (re)attach, so
  a dropped connection or tab switch loses nothing and long-running commands
  survive disconnects (tmux-lite).
- `write(name, data)` / `resize(name, cols, rows)` / `kill(name)` / `list()`.
- PTY spawn is injected (constructor takes a `spawn` function) so unit tests run
  without the native module.
- Sessions live until killed explicitly or the daemon exits. No idle reaper —
  an idle zsh costs nothing; YAGNI.
- `node-pty` is a native module — same rebuild caveat as `better-sqlite3`.

### WS route (`core/src/server/routes/terminal.ts`)

- `GET /ws/terminal/:name` (WebSocket upgrade via `@fastify/websocket`).
  Deliberately **outside `/api/`**: browsers cannot set an `Authorization`
  header on WebSocket, so the existing header gate would break the upgrade.
  Auth instead happens **in-band**: when `authToken` is configured, the first
  frame must be `{type:"auth", token}` (constant-time compare, reusing
  `tokenMatches` semantics); anything else — or 3 s of silence — closes the
  socket. When no token is set, the boot invariant already guarantees a
  loopback bind (`buildApp` refuses non-loopback without `HALO_TOKEN`), so the
  socket is as protected as every other route.
- Project `:name` must exist in `config.projects`; otherwise close with policy
  code 1008. The client never chooses the command or the directory.
- Protocol, JSON text frames:
  - client → server: `{type:"auth",token}` · `{type:"input",data}` ·
    `{type:"resize",cols,rows}`
  - server → client: `{type:"ready",replay}` · `{type:"data",data}` ·
    `{type:"exit",code}`
- REST (behind the normal `/api/` bearer gate):
  - `GET /api/terminal/sessions` — active session names
  - `DELETE /api/terminal/:name` — kill the PTY

### Web (`web/src/terminal/`)

- `Terminal.tsx` (<150 lines) — project chips picker + terminal pane + kill
  button; switching projects detaches the socket but leaves the PTY running.
- `useTerminalSocket.ts` — all logic: socket lifecycle, auth frame from
  `localStorage.halo_token`, write/resize plumbing, auto-reconnect with replay.
- Deps: `@xterm/xterm`, `@xterm/addon-fit`.
- `App.tsx`: add `Terminal` to `VIEWS`; lift `terminalScope` like `chatScope`.
- `ProjectDetail.tsx`: "🖥 Terminal" button beside "💬 Chat about this project".

### Config (`core/src/config/schema.ts`)

```yaml
terminal:            # all optional
  shell: /bin/zsh    # default: $SHELL, else /bin/zsh
  scrollbackBytes: 200000
```

## Security posture (the honest version)

A browser-exposed shell is HALO's most dangerous surface. Mitigations:
allowlisted project names only; command fixed server-side from config; bearer
token required in-band whenever one is configured; non-loopback bind already
impossible without a token; never exposed beyond loopback/Tailscale. **Not**
claimed: the shell is *rooted* in the project dir, not jailed — `cd ..` works.
Jailing a personal shell on your own machine serves nobody; the boundary is
the network + token, and that is stated plainly in the UI docs.

## Testing

- `core/test/terminal-manager.test.ts` — spawn-once-per-project, replay buffer
  truncation, write/resize forwarding, kill, unknown project rejection (fake pty).
- `core/test/terminal-route.test.ts` — via `injectWS`: auth required/timeout/
  bad-token close, unknown project close, input→data round-trip, ready replay,
  REST list/kill. Web UI stays untested, consistent with the codebase (backlog 21).

## Out of scope (YAGNI)

Panes/splits, multiple terminals per project, Claude-mode toggle, idle reaping,
session persistence across daemon restarts, recording/replay of sessions.
