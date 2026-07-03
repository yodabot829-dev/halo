/**
 * One PTY per registered project, living until killed or daemon exit.
 * Output is fanned out to live subscribers and kept in a ring buffer so a
 * (re)attaching client replays what it missed — tmux-lite, not tmux.
 *
 * The PTY spawn is injected: production passes node-pty's spawn (native
 * module), tests pass a fake. The client never chooses the command or cwd —
 * both come from config, keyed by allowlisted project name.
 */

export interface PtyLike {
  pid: number
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawn = (
  shell: string,
  opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
) => PtyLike

export interface TerminalSession {
  /** Buffered output since spawn (tail, capped at scrollbackBytes). */
  replay: string
  /** Live output feed; returns an unsubscribe function. */
  subscribe(cb: (data: string) => void): () => void
  /** Fires once when the shell process exits; returns an unsubscribe function. */
  onExit(cb: (code: number) => void): () => void
}

export interface TerminalManagerOptions {
  /** Registered project name → absolute directory. The allowlist. */
  projects: Record<string, string>
  /** Executable each PTY runs (e.g. "claude" or "/bin/zsh"). */
  command: string
  scrollbackBytes: number
  spawn: PtySpawn
}

interface LiveSession {
  pty: PtyLike
  buffer: string
  subscribers: Set<(data: string) => void>
  exitListeners: Set<(code: number) => void>
}

export class TerminalManager {
  private readonly sessions = new Map<string, LiveSession>()

  constructor(private readonly opts: TerminalManagerOptions) {}

  attach(name: string): TerminalSession {
    // Object.hasOwn, not `name in` — the latter walks the prototype chain, so
    // "constructor"/"__proto__" would pass and resolve to inherited members.
    if (!Object.hasOwn(this.opts.projects, name)) throw new Error(`unknown project: ${name}`)
    const cwd = this.opts.projects[name] as string

    const live = this.sessions.get(name) ?? this.spawn(name, cwd)
    return {
      replay: live.buffer,
      subscribe: (cb) => {
        live.subscribers.add(cb)
        return () => live.subscribers.delete(cb)
      },
      onExit: (cb) => {
        live.exitListeners.add(cb)
        return () => live.exitListeners.delete(cb)
      },
    }
  }

  write(name: string, data: string): void {
    this.sessions.get(name)?.pty.write(data)
  }

  resize(name: string, cols: number, rows: number): void {
    this.sessions.get(name)?.pty.resize(cols, rows)
  }

  kill(name: string): void {
    const live = this.sessions.get(name)
    if (!live) return
    this.sessions.delete(name)
    live.pty.kill()
  }

  list(): string[] {
    return [...this.sessions.keys()]
  }

  /** Kill every session; called on daemon shutdown. */
  killAll(): void {
    for (const name of this.list()) this.kill(name)
  }

  private spawn(name: string, cwd: string): LiveSession {
    const pty = this.opts.spawn(this.opts.command, {
      cwd,
      cols: 80,
      rows: 24,
      env: process.env,
    })
    const live: LiveSession = {
      pty,
      buffer: '',
      subscribers: new Set(),
      exitListeners: new Set(),
    }
    pty.onData((data) => {
      live.buffer = (live.buffer + data).slice(-this.opts.scrollbackBytes)
      for (const cb of live.subscribers) cb(data)
    })
    pty.onExit(({ exitCode }) => {
      // Only evict if THIS session is still the current one — a kill()+reattach
      // may have already replaced it with a fresh PTY.
      if (this.sessions.get(name) === live) this.sessions.delete(name)
      for (const cb of live.exitListeners) cb(exitCode)
    })
    this.sessions.set(name, live)
    return live
  }
}
