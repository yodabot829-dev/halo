import { describe, expect, it, vi } from 'vitest'
import { TerminalManager, type PtyLike, type PtySpawn } from '../src/terminal/manager.js'

/** Minimal fake PTY: capture writes/resizes, let tests emit data/exit. */
function makeFakePty(): PtyLike & {
  emitData: (d: string) => void
  emitExit: (code: number) => void
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  killed: boolean
} {
  let onData: ((d: string) => void) | null = null
  let onExit: ((e: { exitCode: number }) => void) | null = null
  const fake = {
    writes: [] as string[],
    resizes: [] as Array<{ cols: number; rows: number }>,
    killed: false,
    pid: 12345,
    onData: (cb: (d: string) => void) => {
      onData = cb
      return { dispose: () => (onData = null) }
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      onExit = cb
      return { dispose: () => (onExit = null) }
    },
    write: (d: string) => fake.writes.push(d),
    resize: (cols: number, rows: number) => fake.resizes.push({ cols, rows }),
    kill: () => {
      fake.killed = true
    },
    emitData: (d: string) => onData?.(d),
    emitExit: (code: number) => onExit?.({ exitCode: code }),
  }
  return fake
}

function makeManager(opts: { scrollbackBytes?: number } = {}) {
  const ptys: ReturnType<typeof makeFakePty>[] = []
  const spawn: PtySpawn = vi.fn(() => {
    const p = makeFakePty()
    ptys.push(p)
    return p
  })
  const manager = new TerminalManager({
    projects: { halo: '/tmp/halo', aiprojects: '/tmp/aiprojects' },
    command: '/bin/zsh',
    scrollbackBytes: opts.scrollbackBytes ?? 1000,
    spawn,
  })
  return { manager, spawn, ptys }
}

describe('TerminalManager', () => {
  it('rejects unregistered project names', () => {
    const { manager } = makeManager()
    expect(() => manager.attach('evil')).toThrow(/unknown project/)
  })

  it('rejects prototype-chain names (constructor, __proto__)', () => {
    const { manager, spawn } = makeManager()
    expect(() => manager.attach('constructor')).toThrow(/unknown project/)
    expect(() => manager.attach('__proto__')).toThrow(/unknown project/)
    expect(() => manager.attach('hasOwnProperty')).toThrow(/unknown project/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('a stale PTY exit does not evict a freshly respawned session', () => {
    // kill() removes the map entry; the real OS exit event arrives later. If a
    // re-attach spawns a new PTY in that window, the old exit must not delete it.
    const { manager, ptys } = makeManager()
    manager.attach('halo') // ptys[0]
    manager.kill('halo')
    manager.attach('halo') // ptys[1], fresh session
    ptys[0]?.emitExit(0) // stale exit from the killed PTY
    expect(manager.list()).toEqual(['halo'])
    manager.write('halo', 'x')
    expect(ptys[1]?.writes).toEqual(['x'])
    expect(ptys[0]?.writes).toEqual([])
  })

  it('spawns the configured command rooted in the project dir', () => {
    const { manager, spawn } = makeManager()
    manager.attach('halo')
    expect(spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      expect.objectContaining({ cwd: '/tmp/halo' }),
    )
  })

  it('reuses the live session on re-attach (one PTY per project)', () => {
    const { manager, spawn } = makeManager()
    manager.attach('halo')
    manager.attach('halo')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('spawns separate PTYs for separate projects', () => {
    const { manager, spawn } = makeManager()
    manager.attach('halo')
    manager.attach('aiprojects')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('forwards write and resize to the PTY', () => {
    const { manager, ptys } = makeManager()
    manager.attach('halo')
    manager.write('halo', 'ls\r')
    manager.resize('halo', 120, 40)
    expect(ptys[0]?.writes).toEqual(['ls\r'])
    expect(ptys[0]?.resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  it('replays buffered output to a subscriber attached later', () => {
    const { manager, ptys } = makeManager()
    manager.attach('halo')
    ptys[0]?.emitData('early output')
    const seen: string[] = []
    const session = manager.attach('halo')
    expect(session.replay).toBe('early output')
    session.subscribe((d) => seen.push(d))
    ptys[0]?.emitData('live output')
    expect(seen).toEqual(['live output'])
  })

  it('caps the replay buffer at scrollbackBytes, keeping the tail', () => {
    const { manager, ptys } = makeManager({ scrollbackBytes: 10 })
    manager.attach('halo')
    ptys[0]?.emitData('0123456789ABCDEF')
    expect(manager.attach('halo').replay).toBe('6789ABCDEF')
  })

  it('notifies subscribers and clears the session on PTY exit', () => {
    const { manager, ptys, spawn } = makeManager()
    const session = manager.attach('halo')
    const exits: number[] = []
    session.onExit((code) => exits.push(code))
    ptys[0]?.emitExit(7)
    expect(exits).toEqual([7])
    // Session is gone — attaching again spawns a fresh PTY.
    manager.attach('halo')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('kill() terminates the PTY and removes the session', () => {
    const { manager, ptys } = makeManager()
    manager.attach('halo')
    manager.kill('halo')
    expect(ptys[0]?.killed).toBe(true)
    expect(manager.list()).toEqual([])
  })

  it('lists active session names', () => {
    const { manager } = makeManager()
    manager.attach('halo')
    manager.attach('aiprojects')
    expect(manager.list().sort()).toEqual(['aiprojects', 'halo'])
  })

  it('unsubscribe stops delivery without killing the PTY', () => {
    const { manager, ptys } = makeManager()
    const session = manager.attach('halo')
    const seen: string[] = []
    const unsubscribe = session.subscribe((d) => seen.push(d))
    ptys[0]?.emitData('one')
    unsubscribe()
    ptys[0]?.emitData('two')
    expect(seen).toEqual(['one'])
    expect(ptys[0]?.killed).toBe(false)
  })

  it('write/resize/kill on a project with no session are safe no-ops', () => {
    const { manager } = makeManager()
    expect(() => {
      manager.write('halo', 'x')
      manager.resize('halo', 80, 24)
      manager.kill('halo')
    }).not.toThrow()
  })
})
