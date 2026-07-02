import { timingSafeEqual } from 'node:crypto'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1'])

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

/** Constant-time bearer comparison; never leaks length or prefix timing. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header) return false
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(header)
  if (actual.length !== expected.length) {
    // Compare against self to keep timing uniform, then reject.
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(actual, expected)
}
