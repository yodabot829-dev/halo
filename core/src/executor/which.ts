import { execFileSync } from 'node:child_process'

const cache = new Map<string, boolean>()

export function binaryExists(command: string): boolean {
  const cached = cache.get(command)
  if (cached !== undefined) return cached
  let exists = false
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    exists = true
  } catch {
    exists = false
  }
  cache.set(command, exists)
  return exists
}
