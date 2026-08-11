import { describe, expect, it } from 'vitest'
import { originAllowed } from '../src/server/auth.js'
import { appNameFor, groupByApp, isQuittable, parseTopRow, quit } from '../src/system/processes.js'

describe('parseTopRow', () => {
  it('parses pid, memory unit and command', () => {
    expect(parseTopRow('  5060   2276M  Google Chrome He')).toEqual({
      pid: 5060,
      memoryMb: 2276,
      command: 'Google Chrome He',
    })
    expect(parseTopRow('68599  4108M+ com.apple.Virtua')?.memoryMb).toBe(4108)
    expect(parseTopRow('1 1024K launchd')?.memoryMb).toBe(1)
    expect(parseTopRow('999 2G node')?.memoryMb).toBe(2048)
  })

  it('ignores headers and blank lines', () => {
    expect(parseTopRow('PID    MEM   COMMAND')).toBeNull()
    expect(parseTopRow('')).toBeNull()
  })
})

describe('appNameFor', () => {
  it('groups helpers under their parent app', () => {
    const chrome =
      '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper'
    expect(appNameFor(chrome)).toBe('Google Chrome')
    expect(appNameFor('Slack Helper (Renderer)')).toBe('Slack')
    expect(appNameFor('/opt/homebrew/bin/node /path/to/index.ts')).toBe('node')
  })
})

describe('isQuittable', () => {
  it('refuses system daemons, low pids, and HALO itself', () => {
    expect(isQuittable(344, '/usr/libexec/logd')).toBe(false)
    expect(isQuittable(1, '/sbin/launchd')).toBe(false)
    expect(isQuittable(9000, '/System/Library/CoreServices/WindowServer')).toBe(false)
    expect(isQuittable(9001, '/usr/sbin/securityd')).toBe(false)
    expect(isQuittable(process.pid, '/opt/homebrew/bin/node halo')).toBe(false)
  })

  it('allows ordinary user apps', () => {
    expect(isQuittable(5060, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe(
      true,
    )
    expect(isQuittable(17668, '/Users/me/.voicemode/services/kokoro/.venv/bin/python3')).toBe(true)
  })
})

describe('groupByApp', () => {
  it('sums helpers into one row, biggest first, and keeps quittable if any process is', () => {
    const apps = groupByApp([
      { pid: 700, memoryMb: 100, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { pid: 701, memoryMb: 2000, command: '/Applications/Google Chrome.app/Helpers/Google Chrome Helper' },
      { pid: 344, memoryMb: 50, command: '/usr/libexec/logd' },
    ])
    expect(apps.map((a) => [a.app, a.memoryMb, a.quittable])).toEqual([
      ['Google Chrome', 2100, true],
      ['logd', 50, false],
    ])
    expect(apps[0]!.processes).toHaveLength(2)
  })
})

describe('quit', () => {
  it('refuses protected pids without signalling', async () => {
    expect(await quit(1)).toEqual({ ok: false, error: 'pid not permitted' })
    expect(await quit(-5)).toEqual({ ok: false, error: 'pid not permitted' })
    expect(await quit(1.5)).toEqual({ ok: false, error: 'pid not permitted' })
  })

  it('refuses a pid that no longer exists', async () => {
    // 2^22 is above macOS's default pid ceiling, so it can never be live.
    expect(await quit(4_194_303)).toEqual({ ok: false, error: 'no such process' })
  })

  it('refuses to signal HALO itself even though its pid is high', async () => {
    expect(await quit(process.pid)).toEqual({ ok: false, error: 'process is protected' })
  })
})

describe('originAllowed', () => {
  it('passes same-origin and configured origins, blocks a drive-by page', () => {
    const cors = ['https://halo.example']
    expect(originAllowed({ origin: 'http://127.0.0.1:4720', host: '127.0.0.1:4720' }, cors)).toBe(true)
    expect(originAllowed({ origin: 'https://halo.example', host: '127.0.0.1:4720' }, cors)).toBe(true)
    expect(originAllowed({ origin: 'https://evil.example', host: '127.0.0.1:4720' }, cors)).toBe(false)
  })

  it('allows non-browser callers, which send no Origin', () => {
    expect(originAllowed({ host: '127.0.0.1:4720' }, [])).toBe(true)
  })
})
