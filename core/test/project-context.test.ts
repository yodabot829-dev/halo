import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildProjectContext } from '../src/memory/project-context.js'

describe('buildProjectContext', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-proj-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null when nothing is available', () => {
    expect(buildProjectContext('demo', undefined, undefined)).toBeNull()
  })

  it('includes STATE.md when present', () => {
    writeFileSync(join(dir, 'STATE.md'), '# State\n\n## Next\n- ship the thing')
    const ctx = buildProjectContext('demo', dir, undefined)
    expect(ctx).toContain('Active project: demo')
    expect(ctx).toContain('ship the thing')
  })

  it('flags a graphify-out knowledge graph', () => {
    writeFileSync(join(dir, 'STATE.md'), 'x')
    mkdirSync(join(dir, 'graphify-out'))
    expect(buildProjectContext('demo', dir, undefined)).toContain('knowledge graph exists')
  })

  it('truncates to the char budget', () => {
    writeFileSync(join(dir, 'STATE.md'), 'x'.repeat(9000))
    const ctx = buildProjectContext('demo', dir, undefined, 1000)
    expect(ctx!.length).toBeLessThanOrEqual(1000)
  })
})
