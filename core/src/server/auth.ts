import { timingSafeEqual } from 'node:crypto'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1'])

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

/**
 * Browsers always send Origin on cross-site requests and cannot forge it, so
 * rejecting a mismatched Origin closes the drive-by / CSRF vector on routes
 * that DO something. A missing Origin means a non-browser client (tests, CLI,
 * a raw Tailscale peer) — those already have shell access, so they pass.
 *
 * Load-bearing when no auth token is configured, which is the default for a
 * localhost-bound personal OS: it is then the ONLY thing between a malicious
 * open tab and a destructive endpoint.
 */
export function originAllowed(
  headers: { origin?: string; host?: string },
  corsOrigins: string[],
): boolean {
  const { origin, host } = headers
  if (!origin) return true
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true
  return corsOrigins.includes(origin)
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
